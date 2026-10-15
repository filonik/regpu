# @filonik/regpu-xr

`@filonik/regpu-xr` exports an XR-enabled `createREGPU`. It creates a core ReGpu
instance and adds session controls, lifecycle hooks, and view iteration to that same
object. Its `frame` scheduler switches between window and XR session timing. All
rendering/resource methods and the immediate `submit` operation remain available.
XR declarations and lifecycle handling stay here, outside the core library.
See [Hello Cube XR](../regpu-examples/examples/hello-cube-xr/main.ts) for canvas fallback and button handling.

Import `createREGPU`, `XRContext`, `XRFrameContext`, and core types such as `UniformStruct`
and `FrameSource` from `@filonik/regpu-xr`. It re-exports core types and image-loading
helpers. `FrameCallback` is extended to receive `XRFrameContext`: the usual canvas/device,
time, and delta context plus an optional `xrFrame`, present only during an XR tick.
`XRContext` additionally describes an individual view's projection, view transform,
attachments, and viewport. The returned `ReGpuXr` extends the core `ReGpu` interface.

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
import { createREGPU, type XRContext } from '@filonik/regpu-xr'

const regpu = await createREGPU({ canvas })
const stop = regpu.canvasFrame(({ canvas, time }) => {
  drawCanvas(canvas, time)
})
const eyePass = regpu.render.pass<XRContext>({
  colorAttachments: ({ colorAttachment }) => [colorAttachment],
  depthAttachment: ({ depthAttachment }) => depthAttachment,
  viewport: ({ viewport }) => viewport
})
const stopXR = regpu.viewFrame((context) => {
  eyePass(context, () => drawScene(context.projection, context.view, context.time))
})

regpu.onBeforeEnter(() => setButton('Entering XR…', true))
regpu.onEntered(() => setButton('Exit XR', false))
regpu.onBeforeExit(() => setButton('Exiting XR…', true))
regpu.onExited(() => setButton('Enter XR', false))
regpu.onError((error) => {
  showError(error)
  // Failed entry restores idle; a rejected exit keeps the session entered.
  setButton(regpu.state === 'entered' ? 'Exit XR' : 'Enter XR', false)
})

button.addEventListener('click', () => {
  // Enter XR directly from the click handler to preserve user activation.
  const transition = regpu.state === 'entered' ? regpu.exit() : regpu.enter()
  void transition.catch(() => {}) // onError handles failures.
})
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

| Hook | When it runs | State |
| --- | --- | --- |
| `onBeforeEnter` | Before requesting a session, after pausing canvas rendering | `entering` |
| `onEntered` | Reference space, projection layer, and XR frame loop are ready | `entered` |
| `onBeforeExit` | Before a helper-requested exit or cancellation | `exiting` |
| `onExited` | An acquired session has ended and its resources are cleaned up; canvas rendering has resumed if registered | `idle` |
| `onError(error)` | Entry, exit, or rendering fails | Current state; failed entry is `idle`, rejected exit is `entered` |

A normal helper-driven session runs `onBeforeEnter → onEntered → onBeforeExit → onExited`.
Headset/browser exits run `onExited` directly: WebXR exposes only an `end` event, so a
before-exit notification cannot be provided for those exits. Helper-driven exits include
`exit()`, setup failure after acquiring a session, and rendering errors.

Rejected session requests run `onBeforeEnter → onError`, resume the canvas, and leave
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
browser's color textures. Session end stops scheduling, destroys owned depth textures
and the projection layer, and calls `onExited`. `await regpu.exit()` requests an exit and waits for cleanup.

## Scheduling, submission, and views

`regpu.submit(callback)` immediately records and submits commands once. It does not
schedule work or wait for the GPU. `regpu.frame(callback)` registers once-per-tick work;
all default registrations share one scheduler, encoder, and submission in registration
order. There is no object overload. The helper pauses scheduling before requesting a
session, switches to session timing after setup, and resumes window timing after failed
entry or session exit. Each newly started timing source begins with `delta: 0`.

Use shared updates before target iteration, with ordinary control flow for canvas/XR
rendering:

```ts
regpu.frame(({ time, delta, xrFrame }) => {
  updateSimulation(delta)
  updateModel(time)
  if (xrFrame) {
    regpu.perView((context) => {
      eyePass(context, () => drawScene(context.projection, context.view, time))
    })
  } else {
    regpu.perCanvas(({ canvas }) => drawCanvas(canvas, time))
  }
})
```

`perCanvas` selects each initialized canvas, even during XR if explicitly requested.
`perView` iterates the current tracked pose's views and provides an `XRContext` for
each one; it does nothing outside an XR animation callback or when no tracked pose is
available. Both scopes are synchronous and neither schedules nor submits commands.
View attachments and matrices retain the existing explicit `eyePass(context, ...)`
usage shown above.

For separate renderers, `canvasFrame(callback)` and `viewFrame(callback)` are convenience
registrations on that same scheduler. The canvas helper iterates canvases outside XR,
pauses on entry, and resumes on exit or failed entry. The view helper iterates XR views
while active. `xrFrame` remains an alias for `viewFrame`. Shared simulation work belongs
in a preceding `frame` registration, so it runs once per tick rather than once per canvas
or eye. Multiple registrations are supported; new registrations do not replace earlier ones.

Each disposer only unregisters its own callback. It is idempotent, skips the helper's
remaining target callbacks if called during iteration, and stops scheduling when the last
registration is removed. Disposing rendering work does not end the session; use `exit()`
for session lifecycle control. Registrations persist across exit and re-entry. `enter()`
also supports explicit `frame`/`perView` rendering and does not require a view-helper
registration. A session with no rendering registrations remains idle until work is added.

The optional `frame(callback, source)` form still accepts an explicit custom `FrameSource`.
Registrations using the same source object share one loop and submission, independently
of managed window/XR scheduling. These callbacks do not receive an XR frame. An unhandled
error in managed XR work reports `onError` and requests session exit; an unhandled canvas
error stops the managed registrations. One-off submission errors propagate to the caller.

The example browser only grants `xr-spatial-tracking` on its preview iframe. Direct example URLs use
the same controls. Use a secure context (HTTPS or localhost) with an XR/WebGPU-capable
browser and device.

## Validation

From the repository root, `npm run typecheck` covers all three packages and
`npm run build` builds the core, XR package, and examples in dependency order.
The XR package emits ESM, CommonJS, and TypeScript declarations to `dist` and
keeps `@filonik/regpu` external in its JavaScript bundles.

Before declaring headset support verified, run Hello Cube XR directly and in the preview
iframe on a compatible device:

- Confirm both eyes show the rotating cube with correct tracking and depth.
- Exit with the headset controls, confirm the canvas resumes, and enter again.
- Reject or fail session entry, confirm the error appears and the canvas resumes.
- Confirm the button stays hidden in browsers without XR/WebGPU binding support.

The initial integration covers Hello Cube XR only. Multi-pass and other examples need their
own intentional per-eye rendering before adding XR controls.
