import type * as REGPU from './types'

import { createREGPUTextures } from './texture'
import { createREGPUBuffers } from './buffer'
import { createREGPUPipelines } from './pipeline'
import { createREGPUCommands } from './command'
import { resolveCanvases, createCanvasTargets } from './canvas'
import { windowFrameSource } from './frame'

function toRequestAdapterOptions(
  options: REGPU.InitializationOptions
): GPURequestAdapterOptions | undefined {
  // xrCompatible is experimental and absent from some WebGPU declarations.
  return options.xrCompatible !== undefined
    ? ({ xrCompatible: options.xrCompatible } as GPURequestAdapterOptions)
    : undefined
}

function toDeviceDescriptor(options: REGPU.InitializationOptions): GPUDeviceDescriptor | undefined {
  // TODO
  return undefined
}

export async function createCanvasContext(arg: REGPU.InitializationArg) {
  if (!navigator.gpu) throw new Error('WebGPU unsupported')

  const { options, canvases } = resolveCanvases(arg)

  const adapter = await navigator.gpu.requestAdapter(toRequestAdapterOptions(options))

  if (!adapter) throw new Error('Invalid adapter')

  const device = await adapter.requestDevice(toDeviceDescriptor(options))

  const format = options.format ?? navigator.gpu.getPreferredCanvasFormat()
  const targets = createCanvasTargets(device, canvases, format, options.alphaMode ?? 'opaque')
  const primary = targets[0]
  const context: REGPU.Context = {
    canvas: primary.canvas,
    device,
    context: primary.context,
    format,
    time: 0,
    delta: 0
  }
  const byCanvas = new Map(targets.map((target) => [target.canvas, target]))
  const getDepthTexture = () => byCanvas.get(context.canvas)?.getDepthTexture()
  const getCanvasContexts = (frameContext: REGPU.Context): readonly REGPU.CanvasContext[] =>
    targets.map((target) => {
      let colorAttachment: REGPU.ColorAttachment | undefined
      let depthAttachment: REGPU.DepthStencilAttachment | undefined
      return {
        device: frameContext.device,
        format: frameContext.format,
        time: frameContext.time,
        delta: frameContext.delta,
        canvas: target.canvas,
        context: target.context,
        get colorAttachment() {
          return (colorAttachment ??= { view: target.context.getCurrentTexture().createView() })
        },
        get depthAttachment() {
          return (depthAttachment ??= { view: target.getDepthTexture().createView() })
        }
      }
    })
  return { context, targets, format, getDepthTexture, getCanvasContexts }
}

export async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Failed to load texture: ${url}`)
  }

  return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' })
}

export async function loadImageBitmaps(urls: string[]): Promise<ImageBitmap[]> {
  return Promise.all(urls.map((url) => loadImageBitmap(url)))
}

export async function createREGPU(selector: string): Promise<REGPU.ReGpu>
export async function createREGPU(canvas: HTMLCanvasElement): Promise<REGPU.ReGpu>
export async function createREGPU(container: HTMLElement): Promise<REGPU.ReGpu>
export async function createREGPU(canvases: Iterable<HTMLCanvasElement>): Promise<REGPU.ReGpu>
export async function createREGPU(options: REGPU.InitializationOptions): Promise<REGPU.ReGpu>
export async function createREGPU(arg: REGPU.InitializationArg): Promise<REGPU.ReGpu> {
  const { context, getDepthTexture, getCanvasContexts } = await createCanvasContext(arg)
  const buffers = createREGPUBuffers(context)
  const textures = createREGPUTextures(context)
  const pipelines = createREGPUPipelines(context)
  const commands = createREGPUCommands(context, pipelines, getDepthTexture, getCanvasContexts)

  const result = {
    _context: context,
    ...buffers,
    ...textures,
    ...commands,
    windowFrameSource
  }
  return result
}
