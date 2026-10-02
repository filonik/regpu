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

Unlike WebGL and regl, WebGPU records rendering and compute work inside explicit passes. In regpu, `regpu.render.pass(...)` and `regpu.compute.pass(...)` create reusable pass scopes. Calling a pass inside `frame` begins the corresponding WebGPU pass, records the commands invoked by its callback, and ends the pass when the callback returns. Render commands only take effect inside a render pass, and compute commands only take effect inside a compute pass. A frame may contain multiple passes, which execute in the order they are called.

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

Pass `colorAttachments` and `depthAttachment` texture resources to render offscreen. A color attachment may also be an object with a pre-created `view` and optional `clear`, `loadOp`, and `storeOp` values. Set `depthAttachment` to `null` for a color-only pass.

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

## Related

### Main

- https://github.com/regl-project/regl
- https://github.com/webgpu/webgpu-samples

### Other

- https://github.com/WebGLSamples/WebGL2Samples
- https://github.com/software-mansion/TypeGPU
- https://gitlab.com/unconed/use.gpu
- https://github.com/oframe/ogl
