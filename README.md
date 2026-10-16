# regpu

A small functional WebGPU framework inspired by [regl](https://github.com/regl-project/regl). Thin resource wrappers sit alongside composable commands: use `render` for drawing and `compute` for workgroup dispatches.

_DISCLAIMER: This library is still very much experimental and unoptimized. Consider it as an intial API sketch. Not ready for production use. Proceed at your own discretion._

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Compile and Minify for Production

```sh
npm run build
```

### Check Types

```sh
npm run typecheck
```

## Commands and Scopes

Create an instance with a canvas selector, canvas element, container element, or options such as `{ canvas, format, alphaMode }`. A container receives a new canvas. `frame` starts an animation loop and submits commands recorded during each callback; its context contains `canvas`, `device`, `context` (the WebGPU canvas context), and `time` in seconds.

This is the structure of the [triangle example](packages/regpu-examples/examples/hello-triangle/main.ts); its WGSL defines `vs_main` and `fs_main`:

```ts
import { createREGPU } from "@filonik/regpu";
import triangleSource from "./helloTriangle.wgsl?raw";

const regpu = await createREGPU("canvas");
const renderPass = regpu.render.pass({});
const withPipeline = regpu.render({ pipeline: triangleSource });
const drawTriangle = regpu.render({ count: 3 });

regpu.frame(() => {
  renderPass(() => {
    withPipeline(() => {
      drawTriangle();
    });
  });
});
```

A command without a callback draws or dispatches. With a callback, it supplies state to nested commands without issuing a draw itself. Calls support `command()`, `command(props)`, `command(callback)`, and `command(props, callback)`. Passes take `pass(callback)` or `pass(props, callback)` and must execute inside a frame.

State fields can be constants or functions `(props, context) => value`, evaluated on each invocation:

```ts
const draw = regpu.render({
  pipeline: triangleSource,
  count: (props) => props.count,
});

// Inside a render pass:
draw({ count: 3 });
```

For commands with dynamic props, pass their shape as a type argument. The same type is used for
resolver callbacks and command invocations, so values do not need to be cast and missing or invalid
props are reported by TypeScript:

```ts
type DrawProps = {
  uniforms: Record<string, ArrayLike<number>>;
};

const draw = regpu.render<DrawProps>({
  uniforms: (props) => ({ model: props.uniforms }),
  count: 3,
});

draw({ uniforms: { transform: new Float32Array(16) } });
```

Child state overrides parent state. `uniforms`, `textures`, and `samplers` merge by binding name; each uniform struct replaces the parent struct of the same name. State is restored when a scope ends, including when its callback throws. Static pipelines and geometry are created once and reused.

For geometry, provide named `attributes` as flat or nested number arrays (or typed arrays), plus optional `indices`. Indices are uploaded as `uint32`; indexed draws infer their count when omitted. Attributes match shader input names. See the [hello-cube](packages/regpu-examples/examples/hello-cube/main.ts) and [two-cubes](packages/regpu-examples/examples/two-cubes/main.ts) examples for nested scopes and matrices.

## Passes

Unlike WebGL and regl, WebGPU records rendering and compute work inside explicit passes. In regpu, `regpu.render.pass(...)` and `regpu.compute.pass(...)` create reusable pass scopes. Calling a pass inside `submit` or `frame` begins the corresponding WebGPU pass, records the commands invoked by its callback, and ends the pass when the callback returns. Render commands only take effect inside a render pass, and compute commands only take effect inside a compute pass. A frame may contain multiple passes, which execute in the order they are called.

Render-pass state controls attachment behavior such as the color and depth clear values. Like command state, it may use resolver functions, so the same pass can receive different props each time it runs. This small example uses the frame time to cycle the canvas clear color without drawing any geometry:

```ts
import { createREGPU } from "@filonik/regpu";

const regpu = await createREGPU("canvas");

const colors: GPUColor[] = [
  [0.95, 0.25, 0.35, 1],
  [0.25, 0.75, 0.45, 1],
  [0.25, 0.45, 0.95, 1],
];

const renderPass = regpu.render.pass({
  clear: (props) => props,
});

regpu.frame(({ time }) => {
  const color = colors[Math.floor(time) % colors.length];
  renderPass({ color }, () => {});
});
```

The callback is still required even when a pass only clears its attachments. Place draw calls inside that callback to render into the same pass.

Pass `colorAttachments` and `depthAttachment` texture resources to render offscreen. A color attachment may also be an object with a pre-created `view` and optional `clear`, `loadOp`, and `storeOp` values. Set `depthAttachment` to `null` for a color-only pass. Set `viewport: { x, y, width, height }` to render into a pixel region of an attachment.

<!--
### Experimental WebXR

Import `createREGPU` from
[@filonik/regpu-xr](packages/regpu-xr/README.md) to create an
XR-compatible ReGpu instance with session controls, lifecycle hooks, and managed canvas/XR
rendering. Explicit frame sources select window timing, XR-only timing, or window/XR handover.
The helper re-exports core types. It uses the initialized device to render each eye during a WebXR
frame. [Hello Cube XR](packages/regpu-examples/examples/hello-cube-xr/main.ts), listed
in the example browser's XR group, demonstrates an Enter XR button, canvas fallback, and
session cleanup. The binding requires a compatible browser and headset.

Choose `regpu.hybridFrameSource` for window/XR handover, or `regpu.xrFrameSource` for
XR-only timing. Compose shared updates and loops over `canvasContexts` and `viewContexts`
inside one `frame` callback, then call `regpu.enter()` to enter an XR session.
-->

### Render Passes

Render commands are used inside a render pass:

```ts
const renderPass = regpu.render.pass({});
const withPipeline = regpu.render({ pipeline: computeSource });
const draw = regpu.render({ count: 64 });

regpu.frame(() => {
  renderPass(() => {
    withPipeline(() => draw());
  });
});
```

The `count` specifies the number of vertices. Render commands use `instances` for instanced draws. Use `indirect: buffer` to read dispatch arguments from an `INDIRECT` buffer at byte offset zero.

### Compute Passes

Compute commands are used inside a compute pass:

```ts
const computePass = regpu.compute.pass({});
const withPipeline = regpu.compute({ pipeline: computeSource });
const dispatch = regpu.compute({ count: 64 });

regpu.frame(() => {
  computePass(() => {
    withPipeline(() => dispatch());
  });
});
```

The `count` specifies the number of workgroups in X, or accepts `[x, y, z]` for multidimensional dispatches. Use `indirect: buffer` to read dispatch arguments from an `INDIRECT` buffer at byte offset zero.

## Resources

Wrappers expose the native resource as `_gpu`. Passing an existing wrapper back to its factory returns it unchanged. Buffers and textures release their GPU allocations through `destroy()`; shader modules, pipelines, and samplers have a no-op `destroy()` because WebGPU provides no destruction method for them.

```ts
const buffer = regpu.buffer({
  data: new Float32Array([1, 2, 3, 4]),
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const texture = regpu.texture({
  shape: [1, 1],
  data: [255, 255, 255, 255],
});
const sampler = regpu.sampler({ minFilter: "linear", magFilter: "linear" });
const pipeline = regpu.render.pipeline(shaderSource);
```

Buffers accept `data` or `size`; their default usage is `STORAGE | COPY_DST`. Numeric arrays become float32 data. Explicit usage must include `COPY_DST` when uploading initial data. Textures default to `rgba8unorm` and include `TEXTURE_BINDING | COPY_DST` usage. Use `loadImageBitmap(url)` or `loadImageBitmaps(urls)` with the texture's `data` option for image uploads. Six image layers default to a cube view, or set `view.dimension` explicitly.

Call `texture.view()` to get its pre-created default view, or pass a descriptor
to create another native `GPUTextureView`. Views can be created up front and
passed directly to render-pass color attachments:

```ts
const cubemap = regpu.texture({
  shape: [512, 512, 6],
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  view: { dimension: "cube" },
});
const faceViews = Array.from({ length: 6 }, (_, baseArrayLayer) =>
  cubemap.view({
    dimension: "2d",
    baseArrayLayer,
    arrayLayerCount: 1,
  }),
);

const facePass = regpu.render.pass({
  colorAttachments: (props) => [{ view: faceViews[props.face as number] }],
});
```

Render pipelines accept WGSL source, a shader module wrapper, or options with `module`, `vertex`, `fragment`, `primitive`, and explicit binding/attribute layouts. The defaults are `vs_main`, `fs_main`, a triangle list, the canvas color format, and `depth24plus`. Compute pipelines default to `cs_main`.

WGSL reflection discovers vertex inputs and uniform, texture, and sampler bindings used by the selected entry points. Explicit layouts override reflection per category. Supply uniform structs under the corresponding WGSL variable name, textures under their texture variable name, and samplers under their sampler variable name:

```ts
const withMaterial = regpu.render({
  textures: { baseColor: texture },
  samplers: { baseColorSampler: sampler },
  uniforms: { model: { transform: new Float32Array(16) } },
});
```

Corresponds to a WGSL source like:

```wgsl
struct Model {
  transform: mat4x4f,
};

@group(0) @binding(0) var baseColor: texture_2d<f32>;
@group(0) @binding(1) var baseColorSampler: sampler;
@group(1) @binding(0) var<uniform> model: Model;
```

Automatic vertex layouts support float scalars and vectors; uniform packing supports `f32`, float vectors, `mat4x4f`, and fixed-size arrays of those types. Storage buffers are reflected from WGSL and supplied by variable name through `buffers`. Per-frame uniform buffers are released after submission; callers own resource wrappers they create explicitly.

## Advanced Rendering

### Stencil Masks

Render commands accept `stencilReference`, a number or resolver that sets WebGPU's
stencil test/write reference. It defaults to `0`, inherits through command scopes,
and is restored for subsequent draws after a nested scope ends.

Use a pipeline with `depthStencil.format: 'depth24plus-stencil8'` and configure
`stencilFront`/`stencilBack` for writing (`passOp: 'replace'`) or testing
(`compare: 'equal'`). Supply an explicit matching texture through `depthAttachment`;
the automatic canvas depth attachment uses `depth24plus` without stencil.
Set `stencilLoadOp`, `stencilStoreOp`, and optionally `stencilClearValue` on the
attachment object. `clear.stencil` supplies the fallback clear value.

The [Stencil Mask example](packages/regpu-examples/examples/stencil-mask/main.ts)
ports WebGPU Samples' six cube-face masks and seven animated scenes. The only API
extension needed is `stencilReference`; pipeline stencil settings, explicit
attachments, and independent depth/stencil load/store operations already exist.
Each scene clears depth while loading the previous color and stencil values.

### Immediate Rendering

`submit(callback)` immediately creates a command encoder, calls the callback synchronously,
finishes the encoder, and submits its command buffer. It releases temporary uniform buffers
after submission and returns without waiting for GPU completion. Use it for rendering on
demand or one-off compute work. Callbacks must be synchronous; `submit` cannot be nested
inside another submission or a scheduled frame. If the callback throws, its recorded
commands are discarded and temporary buffers are still released.

Passes record commands into the current encoder. A scheduled frame creates one encoder,
calls its callback, and submits after the callback returns. For immediate work, `submit`
provides the recording context instead.

### Animation Loop

`frame(callback, source = regpu.windowFrameSource)` runs one synchronous callback per
animation tick and returns an idempotent stop function. Only one callback per source
object may be active on an instance: a second registration throws until the first is
stopped. Compose updates and rendering explicitly inside that callback:

```ts
const stop = regpu.frame(({ delta }) => {
  updateSimulation(delta);
  drawScene();
});
```

Each tick uses one command encoder and submission. The first tick has `delta: 0`;
stopping and restarting also begins with `delta: 0`. Stopping inside the callback
cancels future ticks; the rest of that synchronous callback still runs and its commands
are submitted. A thrown callback aborts the submission and stops its loop.

The `FrameContext` callback contains `canvas`, `device`, `context` (the WebGPU canvas context),
`format`, `time` in seconds, `delta` in seconds, and `canvasContexts`, a readonly array of
`CanvasContext` targets. The first canvas is the default target.
`submit` uses the latest context without advancing the animation clock; before the first
scheduled tick, `time` and `delta` are zero.

A custom `FrameSource` retains the `{ request(callback), cancel(handle) }` interface.
Each request must deliver one asynchronous callback with a timestamp in milliseconds;
callbacks and command scopes must stay synchronous. Cancellation and duplicate-delivery
guards ignore stale callbacks, including messages already in flight from a worker.
Different source objects have independent clocks, encoders, and submissions. Use a single
callback when rendering work needs a shared update, ordering, or submission.
`windowFrameSource` is also available as a named export.

### Multi-Canvas Rendering

`frame` and `submit` provide `canvasContexts`, a readonly array supporting `for…of`
and `.forEach`. Pass each context to an explicit render pass to select its attachments.

The `canvas` option accepts a single canvas, a selector matching canvases, or an iterable
such as an array, `NodeList`, or `Set`. Every instance uses a fixed list of canvases;
a single canvas is simply a list of one. Duplicates are removed and empty selections
or selections containing non-canvas elements are rejected. A top-level selector matching
one container still creates a canvas inside it.

```ts
import { createREGPU, type CanvasContext } from "@filonik/regpu";

const regpu = await createREGPU({ canvas: ".preview" });
// Also: createREGPU([canvasA, canvasB]) or createREGPU(document.querySelectorAll('canvas'))
const pass = regpu.render.pass<CanvasContext>({
  colorAttachments: ({ colorAttachment }) => [colorAttachment],
  depthAttachment: ({ depthAttachment }) => depthAttachment,
});

const stop = regpu.frame(({ time, canvasContexts }) => {
  canvasContexts.forEach((context) => {
    const { canvas } = context;
    const aspect = canvas.width / canvas.height;
    pass(context, () => drawScene({ aspect, time }));
  });
});
```

Each `CanvasContext` contains its canvas, `GPUCanvasContext`, color/depth attachments,
and the same `time` and `delta` for the whole tick, in initialization order. Contexts and
attachment views are scoped to the current synchronous callback. Iteration leaves the
default target and command resolver context on the first canvas; use the explicit props
for each target. Bind both attachments for canvases of different sizes, or set
`depthAttachment: null` for a pass without depth. All passes share one command encoder
and submission; pipelines, buffers, textures, and the device are shared across the instance.
All canvases use the configured presentation format and alpha mode.

Each canvas follows its CSS size and device pixel ratio through `ResizeObserver`, with
backing dimensions clamped to the device limit. Give canvases CSS dimensions independent
of their backing-store attributes, for example `width: 100%; height: 200px`. Depth textures
are created only when a depth attachment is accessed or a pass requests default depth.
They are recreated only for the canvas whose dimensions changed. `depthAttachment: null`
avoids allocating depth.

Use `frame` for shared simulation/compute work, followed by explicit canvas iteration:

```ts
regpu.frame(({ delta, canvasContexts }) => {
  updateSimulation(delta);
  canvasContexts.forEach((context) => {
    const { canvas } = context;
    pass(context, () => drawScene({ aspect: canvas.width / canvas.height }));
  });
});
```

To render once, use `submit(({ canvasContexts }) => canvasContexts.forEach(callback))`.
Merely accessing or iterating the array acquires no canvas textures. Color/depth attachment
getters acquire and cache their views on first access, so filtering offscreen targets
before accessing attachments avoids their GPU work.

The [Multiple Canvases example](packages/regpu-examples/examples/multiple-canvases/main.ts)
creates 200 previews with different sizes and colors, one pipeline, and one device.
An `IntersectionObserver` maintains a visibility set; the callback returns before any
GPU work for offscreen canvases. The example includes pause/resume, a preview-size control,
and a switch for comparing visible-only rendering with rendering every canvas.

## Related

### Main

- https://github.com/regl-project/regl
- https://github.com/webgpu/webgpu-samples

### Other

- https://github.com/WebGLSamples/WebGL2Samples
- https://github.com/software-mansion/TypeGPU
- https://gitlab.com/unconed/use.gpu
- https://github.com/oframe/ogl
