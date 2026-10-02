/// <reference types="@webgpu/types" preserve="true" />

export type Callback = () => void

export type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Uint8ClampedArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor

export type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array

export type Props = Record<string, unknown>
export type State = Record<string, unknown>

export interface Command<P extends object = Props> {
  (): void
  (props: P): void
}

export interface Scope<P extends object = Props> {
  (cb: Callback): void
  (props: P, cb: Callback): void
}

export type Context = {
  canvas: HTMLCanvasElement
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
  /** Seconds since the page's time origin. */
  time: number
  /** Seconds elapsed since the previous frame, or zero on the first frame. */
  delta: number
}

export type FrameCallback = (context: Context) => void

export type InitializationOptions = {
  canvas?: HTMLCanvasElement
  container?: HTMLElement
  alphaMode?: GPUCanvasAlphaMode
  format?: GPUTextureFormat
}

export type InitializationArg = string | HTMLElement | InitializationOptions

interface Resource {
  destroy(): void
}

export interface Buffer extends Resource {
  _gpu: GPUBuffer
}
export interface Texture extends Resource {
  _gpu: GPUTexture
  /** Returns the default view, or creates a view with the supplied descriptor. */
  view(descriptor?: GPUTextureViewDescriptor): GPUTextureView
}
export interface Sampler extends Resource {
  _gpu: GPUSampler
}
export interface ShaderModule extends Resource {
  _gpu: GPUShaderModule
}
export interface RenderPipeline extends Resource {
  _gpu: GPURenderPipeline
}
export interface ComputePipeline extends Resource {
  _gpu: GPUComputePipeline
}

export type UniformData = ArrayLike<number>
export type UniformStruct = Record<string, UniformData>
export type UniformValue = UniformData | UniformStruct
export type Uniforms = Record<string, UniformValue>
export type Textures = Record<string, Texture>
export type Samplers = Record<string, Sampler>
export type Buffers = Record<string, Buffer>

export type TextureArrayData = number[] | number[][] | number[][][] | TypedArray

export type TextureImageData = ImageBitmap | ImageBitmap[]

type Code = string

export interface BufferOptions {
  data?: ArrayBuffer | TypedArray | number[] | number[][]
  size?: number
  usage?: GPUBufferUsageFlags
  label?: string
}

export type BufferArg = BufferOptions

export interface TextureOptions {
  shape?: [number, number, number?]
  data?: TextureArrayData | TextureImageData | null
  format?: GPUTextureFormat
  usage?: GPUTextureUsageFlags
  dimension?: GPUTextureDimension
  view?: GPUTextureViewDescriptor
  flipY?: boolean
  premultipliedAlpha?: boolean
  colorSpace?: PredefinedColorSpace
  baseArrayLayer?: number
}

export type TextureArg = TextureOptions

export type SamplerOptions = GPUSamplerDescriptor

export type SamplerArg = SamplerOptions

export interface ShaderModuleOptions {
  label?: string
  code: Code
}

export type ShaderModuleArg = Code | ShaderModuleOptions

export interface RenderPipelineOptions {
  label?: string
  layout?: GPUAutoLayoutMode | GPUPipelineLayout
  module?: ShaderModule | ShaderModuleArg
  vertex?: Partial<GPUVertexState>
  fragment?: Partial<GPUFragmentState>
  primitive?: GPUPrimitiveState
  /** Blending for the default color target. */
  blend?: GPUBlendState
  /** Set to `null` to create a pipeline without a depth/stencil attachment. */
  depthStencil?: GPUDepthStencilState | null
  attributes?: PipelineAttributeLayout
  uniforms?: PipelineUniformLayout
  textures?: PipelineTextureLayout
  samplers?: PipelineSamplerLayout
  buffers?: PipelineBufferLayout
}

export type RenderPipelineArg = ShaderModule | ShaderModuleArg | RenderPipelineOptions

export interface ComputePipelineOptions {
  label?: string
  layout?: GPUAutoLayoutMode | GPUPipelineLayout
  module?: ShaderModule | ShaderModuleArg
  entryPoint?: string
  uniforms?: PipelineUniformLayout
  textures?: PipelineTextureLayout
  samplers?: PipelineSamplerLayout
  buffers?: PipelineBufferLayout
}

export type ComputePipelineArg = ShaderModule | ShaderModuleArg | ComputePipelineOptions

export type RenderPipelineProps = {
  uniforms?: Uniforms
  textures?: Textures
  samplers?: Samplers
  buffers?: Buffers
}

export type ComputePipelineProps = {
  uniforms?: Uniforms
  textures?: Textures
  samplers?: Samplers
  buffers?: Buffers
}

export type PipelineUniformLayout =
  | Record<string, string>
  | Record<
      string,
      {
        group: number
        binding: number
        type: Record<string, string>
      }
    >

export type PipelineAttributeLayout = Record<
  string,
  | string
  | {
      location?: number
      type: string
      stepMode?: GPUVertexStepMode
    }
>

export type PipelineTextureLayout = Record<
  string,
  {
    group: number
    binding: number
    view?: GPUTextureViewDescriptor
  }
>

export type PipelineSamplerLayout = Record<
  string,
  {
    group: number
    binding: number
  }
>

export type PipelineBufferLayout = Record<
  string,
  {
    group: number
    binding: number
  }
>

export type RenderPassProps = {
  clear?: {
    color?: GPUColor
    depth?: number
  }
  colorAttachments?: Array<
    | Texture
    | {
        /** A pre-created texture view to use directly as the attachment. */
        view: GPUTextureView
        clear?: GPUColor
        loadOp?: GPULoadOp
        storeOp?: GPUStoreOp
      }
  >
  /** Overrides the automatically managed canvas depth texture. */
  depthAttachment?: Texture | null
}

export type ComputePassProps = {}

export type VertexData = ArrayLike<number> | ArrayLike<ArrayLike<number>>

export type ResolvedCommandState = RenderPipelineProps &
  RenderPassProps & {
    pipeline?: RenderPipeline | ComputePipeline | RenderPipelineArg | ComputePipelineArg
    attributes?: Record<string, VertexData>
    indices?: VertexData
    count?: number | [number, number?, number?]
    instances?: number
    indirect?: Buffer
  }

export type Resolver<T, P extends object = Props> = T | ((props: P, context: Context) => T)

// Keep arbitrary scope state while giving the built-in fields contextual types.
export type CommandState<P extends object = Props> = {
  [K in keyof ResolvedCommandState]?: Resolver<ResolvedCommandState[K], P>
} & Record<string, unknown>

interface ComputePass {
  <P extends object = Props>(state: CommandState<P>): Scope<P>
}
interface ComputeCommand {
  <P extends object = Props>(state: CommandState<P>): Command<P> & Scope<P>
  pipeline(arg: ComputePipeline | ComputePipelineArg): ComputePipeline
  pass: ComputePass
}

interface RenderPass {
  <P extends object = Props>(state: CommandState<P>): Scope<P>
}
interface RenderCommand {
  <P extends object = Props>(state: CommandState<P>): Command<P> & Scope<P>
  pipeline(arg: RenderPipeline | RenderPipelineArg): RenderPipeline
  pass: RenderPass
}

export interface ReGpu {
  compute: ComputeCommand
  render: RenderCommand

  buffer(arg: Buffer | BufferArg): Buffer
  sampler(arg?: Sampler | SamplerArg): Sampler
  texture(arg: Texture | TextureArg): Texture
  module(arg: ShaderModule | ShaderModuleArg): ShaderModule

  frame(cb: FrameCallback): void
}
