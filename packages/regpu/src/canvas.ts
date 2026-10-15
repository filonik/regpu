import type { CanvasArg, InitializationArg, InitializationOptions } from './types'

function isElement(value: unknown): value is HTMLElement {
  return typeof value === 'object' && value !== null && 'nodeName' in value
}

function isCanvas(value: unknown): value is HTMLCanvasElement {
  return isElement(value) && value.nodeName.toLowerCase() === 'canvas'
}

/** Resolve every input to a fixed, deduplicated list, including the single-canvas case. */
export function resolveCanvases(arg: InitializationArg) {
  let options: InitializationOptions
  if (typeof arg === 'string') {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(arg))
    options =
      elements.length === 1 && !isCanvas(elements[0])
        ? { container: elements[0] }
        : { canvas: elements as HTMLCanvasElement[] }
  } else if (isElement(arg)) {
    options = isCanvas(arg) ? { canvas: arg } : { container: arg }
  } else if (Symbol.iterator in arg) {
    options = { canvas: arg }
  } else {
    options = arg
  }

  let input: CanvasArg | undefined = options.canvas
  if (input === undefined) {
    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    const container = options.container ?? document.body
    container.appendChild(canvas)
    input = canvas
  }
  const values =
    typeof input === 'string'
      ? Array.from(document.querySelectorAll(input))
      : isElement(input)
        ? [input]
        : Array.from(input)
  if (values.length === 0) throw new Error('No canvases matched the initialization input')
  if (!values.every(isCanvas)) throw new Error('The canvas input must contain only canvas elements')
  return { options, canvases: [...new Set(values)] }
}

export function createCanvasTargets(
  device: GPUDevice,
  canvases: HTMLCanvasElement[],
  format: GPUTextureFormat,
  alphaMode: GPUCanvasAlphaMode
) {
  const targets = canvases.map((canvas) => {
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('Invalid WebGPU canvas context')
    let depth: GPUTexture | undefined

    function resize(width = canvas.clientWidth, height = canvas.clientHeight) {
      const dpr = globalThis.devicePixelRatio || 1
      const limit = device.limits.maxTextureDimension2D
      const nextWidth = Math.max(1, Math.min(limit, Math.floor(width * dpr)))
      const nextHeight = Math.max(1, Math.min(limit, Math.floor(height * dpr)))
      const cssWidth = canvas.clientWidth
      const cssHeight = canvas.clientHeight
      if (canvas.width !== nextWidth) canvas.width = nextWidth
      if (canvas.height !== nextHeight) canvas.height = nextHeight
      // Preserve intrinsic CSS sizing when backing-store changes would otherwise feed
      // back into ResizeObserver (for example, an unstyled canvas on a HiDPI display).
      if (canvas.clientWidth !== cssWidth) canvas.style.width = `${cssWidth}px`
      if (canvas.clientHeight !== cssHeight) canvas.style.height = `${cssHeight}px`
      if (depth && (depth.width !== canvas.width || depth.height !== canvas.height)) {
        depth.destroy()
        depth = undefined
      }
    }

    resize()
    context.configure({ device, format, alphaMode })
    return {
      canvas,
      context,
      resize,
      getDepthTexture() {
        // No depth allocation until a pass requests this canvas's default depth attachment.
        if (depth && (depth.width !== canvas.width || depth.height !== canvas.height)) {
          depth.destroy()
          depth = undefined
        }
        depth ??= device.createTexture({
          size: [canvas.width, canvas.height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        })
        return depth
      }
    }
  })
  const byCanvas = new Map(targets.map((target) => [target.canvas, target]))
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        byCanvas
          .get(entry.target as HTMLCanvasElement)
          ?.resize(entry.contentRect.width, entry.contentRect.height)
      }
    })
    for (const target of targets) observer.observe(target.canvas)
  }
  // Also handle device-pixel-ratio changes, including in browsers without ResizeObserver.
  addEventListener('resize', () => targets.forEach((target) => target.resize()))
  return targets
}
