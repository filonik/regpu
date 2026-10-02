import type * as REGPU from './types'

import { createREGPUTextures } from './texture'
import { createREGPUBuffers } from './buffer'
import { createREGPUPipelines } from './pipeline'
import { createREGPUCommands } from './command'

function isHTMLElement(arg: REGPU.InitializationArg): arg is HTMLElement {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    'nodeName' in arg &&
    'appendChild' in arg &&
    'getBoundingClientRect' in arg &&
    typeof arg.nodeName === 'string' &&
    typeof arg.appendChild === 'function' &&
    typeof arg.getBoundingClientRect === 'function'
  )
}

function isHTMLCanvasElement(element: HTMLElement): element is HTMLCanvasElement {
  return element.nodeName.toLowerCase() === 'canvas'
}

function normalizeInitializationOptions(arg: REGPU.InitializationArg): REGPU.InitializationOptions {
  let element: HTMLElement | undefined
  let canvas: HTMLCanvasElement | undefined
  let container: HTMLElement | undefined
  let alphaMode: GPUCanvasAlphaMode | undefined
  let format: GPUTextureFormat | undefined
  if (typeof arg === 'string') {
    element = document.querySelector<HTMLElement>(arg) ?? undefined
  } else {
    if (isHTMLElement(arg)) {
      element = arg
    } else {
      if ('canvas' in arg) {
        canvas = arg.canvas
      } else if ('container' in arg) {
        container = arg.container
      }
      alphaMode = arg.alphaMode
      format = arg.format
    }
  }

  if (element) {
    if (isHTMLCanvasElement(element)) {
      canvas = element
    } else {
      container = element
    }
  }

  return {
    canvas,
    container,
    alphaMode,
    format
  }
}

function resolveCanvas(arg: REGPU.InitializationOptions) {
  if (arg.canvas) return arg.canvas

  const canvas = document.createElement('canvas')
  const container = arg.container ?? document.body

  canvas.style.width = '100%'
  canvas.style.height = '100%'

  container.appendChild(canvas)

  return canvas
}

export async function createCanvasContext(arg: REGPU.InitializationArg) {
  if (!navigator.gpu) throw new Error('WebGPU unsupported')

  const options = normalizeInitializationOptions(arg)

  if (!options) throw new Error('Invalid options')

  const canvas = resolveCanvas(options)

  if (!canvas) throw new Error('Invalid canvas')

  const adapter = await navigator.gpu.requestAdapter()

  if (!adapter) throw new Error('Invalid adapter')

  const device = await adapter.requestDevice()

  const canvasContext = canvas.getContext('webgpu')

  if (!canvasContext) throw new Error('Invalid context')

  const format = options.format ?? navigator.gpu.getPreferredCanvasFormat()

  const alphaMode = options.alphaMode ?? 'opaque'

  const context: REGPU.Context = {
    canvas,
    device,
    context: canvasContext,
    format,
    time: 0,
    delta: 0
  }

  let depthTexture: GPUTexture | undefined

  function resize() {
    if (!canvasContext) return

    const dpr = globalThis.devicePixelRatio || 1

    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr))

    depthTexture?.destroy()
    depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    })

    canvasContext.configure({
      device,
      format,
      alphaMode
    })
  }

  resize()

  addEventListener('resize', resize)

  return { context, format, getDepthTexture: () => depthTexture }
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
export async function createREGPU(options: REGPU.InitializationOptions): Promise<REGPU.ReGpu>
export async function createREGPU(arg: REGPU.InitializationArg): Promise<REGPU.ReGpu> {
  const { context, getDepthTexture } = await createCanvasContext(arg)
  const buffers = createREGPUBuffers(context)
  const textures = createREGPUTextures(context)
  const pipelines = createREGPUPipelines(context)
  const commands = createREGPUCommands(context, pipelines, getDepthTexture)

  return {
    ...buffers,
    ...textures,
    ...commands
  }
}
