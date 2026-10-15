import type * as REGPU from './types'

import { createREGPUTextures } from './texture'
import { createREGPUBuffers } from './buffer'
import { createREGPUPipelines } from './pipeline'
import { createREGPUCommands } from './command'
import { resolveCanvases, createCanvasTargets } from './canvas'

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
  return { context, targets, format, getDepthTexture }
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
  const { context, targets, getDepthTexture } = await createCanvasContext(arg)
  const buffers = createREGPUBuffers(context)
  const textures = createREGPUTextures(context)
  const pipelines = createREGPUPipelines(context)
  const commands = createREGPUCommands(context, pipelines, getDepthTexture)
  function perCanvas(callback: REGPU.FrameCallback) {
    const { canvas, context: canvasContext, time, delta } = context
    try {
      for (const target of targets) {
        context.canvas = target.canvas
        context.context = target.context
        context.time = time
        context.delta = delta
        callback(context)
      }
    } finally {
      context.canvas = canvas
      context.context = canvasContext
      context.time = time
      context.delta = delta
    }
  }

  function canvasFrame(callback: REGPU.FrameCallback) {
    let stopped = false
    const stop = commands.frame(() => {
      perCanvas((context) => {
        if (!stopped) callback(context)
      })
    })
    return () => {
      stopped = true
      stop()
    }
  }

  const result = {
    _context: context,
    ...buffers,
    ...textures,
    ...commands,
    perCanvas,
    canvasFrame
  }
  return result
}
