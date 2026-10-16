# @filonik/regpu-xr

`@filonik/regpu-xr` exports an XR-enabled `createREGPU`. It creates a core ReGpu
instance and adds session controls, lifecycle hooks, and view contexts to that same
object. Explicit frame sources select window timing, XR-only timing, or window/XR
handover. The default `frame` source remains window timing. All
rendering/resource methods and the immediate `submit` operation remain available.
XR declarations and lifecycle handling stay here, outside the core library.
See [Hello Cube XR](../regpu-examples/examples/hello-cube-xr/main.ts) for canvas fallback and button handling.

Import `createREGPU`, `XRViewContext`, `XRFrameContext`, and core types such as
`CanvasContext`, `UniformStruct`, and `FrameSource` from `@filonik/regpu-xr`.
It re-exports core types and image-loading
helpers. `FrameCallback` is extended to receive `XRFrameContext`: the core `FrameContext`
including `canvasContexts`, plus `viewContexts` and an optional `xrFrame`, present only
during an XR tick. The session is available through `xrFrame.session`. `XRViewContext`
describes an individual view's projection, view transform, attachments, and viewport.
The returned `ReGpuXr` extends the core `ReGpu` interface.

The factory accepts a selector, canvas, iterable of canvases, container, or initialization options, and always
requests an XR-compatible adapter. Pass `mode` alongside the core options; it defaults
to `immersive-vr`. For example: `createREGPU({ canvas, mode: 'immersive-vr' })`.
This replaces the two-step `createREGPU` / `createREXR` setup.

Install this package alongside its core peer dependency:

```sh
npm install @filonik/regpu @filonik/regpu-xr
```

Standard WebXR types come from the package dependency `@types/webxr`. The emitted
declarations reference both WebXR and WebGPU types, so consumers do not need to add
WebXR to their `compilerOptions.types`. The globals are used directly without imports
from `webxr`. The experimental WebGPU binding is not included in `@types/webxr` 0.5.24,
so [webgpu.d.ts](src/webgpu.d.ts) supplies only that binding's additional types locally.

```ts
import { createREGPU, type CanvasContext, type XRViewContext } from "@filonik/regpu-xr";

const regpu = await createREGPU({ canvas });
const xrPass = regpu.render.pass<XRViewContext>({
  colorAttachments: ({ colorAttachment }) => [colorAttachment],
  depthAttachment: ({ depthAttachment }) => depthAttachment,
  viewport: ({ viewport }) => viewport,
});
const canvasPass = regpu.render.pass<CanvasContext>({
  colorAttachments: ({ colorAttachment }) => [colorAttachment],
  depthAttachment: ({ depthAttachment }) => depthAttachment,
});
const stop = regpu.frame(({ time, delta, canvasContexts, viewContexts, xrFrame }) => {
  updateSimulation(delta);
  if (xrFrame) {
    viewContexts.forEach((context) => {
      xrPass(context, () => drawScene(context.projection, context.view, time));
    });
  } else {
    canvasContexts.forEach((context) => {
      canvasPass(context, () => drawCanvas(context.canvas, time));
    });
  }
}, regpu.hybridFrameSource);

regpu.onBeforeEnter(() => setButton("Entering XR…", true));
regpu.onEntered(() => setButton("Exit XR", false));
regpu.onBeforeExit(() => setButton("Exiting XR…", true));
regpu.onExited(() => setButton("Enter XR", false));
regpu.onError((error) => {
  showError(error);
  // Failed entry restores idle; a rejected exit keeps the session entered.
  setButton(regpu.state === "entered" ? "Exit XR" : "Enter XR", false);
});

button.addEventListener("click", () => {
  // Enter XR directly from the click handler to preserve user activation.
  const transition = regpu.state === "entered" ? regpu.exit() : regpu.enter();
  void transition.catch(() => {}); // onError handles failures.
});
```

Hide the button until `await regpu.isSupported()` is true. Call `enter` directly from the
click handler: it requests the session before its first await. It requires `webgpu`,
requests optional `local-floor` space, and falls back to `local`. Support detection cannot
guarantee the experimental `webgpu` session feature; entry can still fail.

## Session lifecycle

Register hooks on the helper, for example `const off = regpu.onEntered(callback)`.
Each registration returns an unsubscribe function. Multiple observers are supported;
registrations persist across sessions and run in registration order. This replaces the
old assignable `onEnd` callback with `onExited(callback)`.

`regpu.state` is read-only: `idle`, `entering`, `entered`, or `exiting`. State is updated
before each hook runs:

| Hook             | When it runs                                                                                                | State                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `onBeforeEnter`  | Before requesting a session; the hybrid source has paused window timing                                     | `entering`                                                        |
| `onEntered`      | Reference space, projection layer, and XR frame loop are ready                                              | `entered`                                                         |
| `onBeforeExit`   | Before requesting exit or cancellation                                                                      | `exiting`                                                         |
| `onExited`       | An acquired session has ended and its resources are cleaned up; the hybrid source has resumed window timing | `idle`                                                            |
| `onError(error)` | Entry, exit, or rendering fails                                                                             | Current state; failed entry is `idle`, rejected exit is `entered` |

A normal helper-driven session runs `onBeforeEnter → onEntered → onBeforeExit → onExited`.
Headset/browser exits run `onExited` directly: WebXR exposes only an `end` event, so a
before-exit notification cannot be provided for those exits. Helper-driven exits include
`exit()`, setup failure after acquiring a session, and rendering errors.

Rejected session requests run `onBeforeEnter → onError`, resume hybrid window timing, and leave
state `idle`. If a session was acquired before entry failed or was cancelled, it is ended
and cleaned up before `onExited` and `onError`; `onEntered` never fires for failed entry.
Calling `exit()` during entry cancels it and waits for entry/cleanup to settle. Repeated
exit requests share the pending exit. A rejected exit reports `onError`, restores the
active state, and permits retrying. `exit()` while idle is a no-op.

Hooks are synchronous notifications, not awaited guards: they cannot delay or veto a
transition. Keep `onBeforeEnter` synchronous so `requestSession` retains user activation.
Thrown/rejected hook errors are reported through `globalThis.reportError` (or
`console.error`) without interrupting other hooks or session cleanup. `enter()` and
`exit()` still reject on failure; handle their promises even when using `onError`.

The projection layer uses the initialized canvas format, matching ordinary scene pipelines.
Each eye gets its XR projection matrix, inverse view transform, array-slice color view,
viewport, and a private `depth24plus` texture. Apply the viewport even when it currently
covers the full texture. Depth textures are reused until dimensions change. Color views
and XR frames are valid only during the draw callback; the helper never destroys the
browser's color textures. Session end pauses XR-only timing, restores hybrid window timing,
destroys owned depth textures and the projection layer, and calls `onExited`.
`await regpu.exit()` requests an exit and waits for cleanup.

## Scheduling, submission, and views

`regpu.submit(callback)` immediately records and submits commands once. It does not
schedule work or wait for the GPU. `regpu.frame(callback, source)` runs one synchronous
callback per tick, with one encoder and submission. Each instance accepts one active
callback per source object; a second registration on that source throws. Compose shared
updates, passes, and target iteration inside that callback, in ordinary execution order.

Choose the scheduling policy explicitly. The XR-only and hybrid sources belong to the
XR instance; all sources retain the core `{ request(callback), cancel(handle) }` interface:

| Source                              | Outside a ready XR session | During a ready XR session |
| ----------------------------------- | -------------------------- | ------------------------- |
| `regpu.windowFrameSource` (default) | Window animation frames    | Window animation frames   |
| `regpu.xrFrameSource`               | Dormant                    | XR animation frames       |
| `regpu.hybridFrameSource`           | Window animation frames    | XR animation frames       |

The hybrid source pauses during entry and exit, switches to session timing after setup,
and resumes window timing after failed entry or session end. XR-only timing remains
dormant until the next session is ready. Both sources preserve registrations across exit
and re-entry and reset `delta` to zero on each clock switch or restart. Window timing is
independent of XR lifecycle; the browser may throttle it during immersive presentation.
A session with no pending frame requests does not schedule animation callbacks.

`canvasContexts` contains every initialized canvas, including during XR. `viewContexts`
is a readonly array of `XRViewContext` targets in pose order, supporting `for…of` and
`.forEach`; it is empty outside an XR tick or without a tracked pose. View contexts are
created on first access and cached for the tick. Neither array schedules or submits commands,
and iteration does not change the default canvas target. Bind attachments through the
explicit `xrPass(context, ...)` and `canvasPass(context, ...)` scopes shown above.
Use `xrFrame` to distinguish XR timing even when tracking temporarily yields no views.

For XR-only rendering with a canvas mirror, render both targets in the same callback.
Simulation still runs once, and all passes use one submission:

```ts
const stop = regpu.frame(({ delta, time, canvasContexts, viewContexts }) => {
  updateSimulation(delta);
  viewContexts.forEach((context) => {
    xrPass(context, () => drawScene(context.projection, context.view, time));
  });
  canvasContexts.forEach((context) => {
    canvasPass(context, () => drawCanvas(context.canvas, time));
  });
}, regpu.xrFrameSource);
```

Omit canvas iteration for XR-only rendering without a canvas fallback or mirror. Initialization
still requires a canvas; canvas-free device/context initialization is a separate concern.
`xrFrame` is present only during a tick delivered by this instance's XR-only or hybrid
source. Custom sources and the window source receive no XR frame,
and have empty `viewContexts`. A one-off `submit` outside an XR tick behaves the same way.
The named core export `windowFrameSource` is also re-exported here.

The stop function is idempotent and cancels future ticks; it does not interrupt the rest
of the current synchronous callback or end the session. Use `exit()` for session control.
Late deliveries after cancellation, source handover, or session exit are ignored. Source
requests must be asynchronous and one-shot, and rendering callbacks must not `await`.
Different source objects have independent loops and submissions.

A thrown rendering callback aborts that tick's submission, stops its loop, and reports
`onError`. Errors in an XR tick also request session exit. One-off `submit` errors
propagate to the caller.

The example browser only grants `xr-spatial-tracking` on its preview iframe. Direct example URLs use
the same controls. Use a secure context (HTTPS or localhost) with an XR/WebGPU-capable
browser and device.

## Validation

Before declaring headset support verified, run Hello Cube XR directly and in the preview
iframe on a compatible device:

- Confirm both eyes show the rotating cube with correct tracking and depth.
- Exit with the headset controls, confirm the canvas resumes, and enter again.
- Reject or fail session entry, confirm the error appears and the canvas resumes.
- Confirm the button stays hidden in browsers without XR/WebGPU binding support.

The initial integration covers Hello Cube XR only. Multi-pass and other examples need their
own intentional per-eye rendering before adding XR controls.
