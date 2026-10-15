/// <reference types="@webgpu/types" preserve="true" />
/// <reference types="webxr" preserve="true" />

import { createREGPU as createCoreREGPU } from '@filonik/regpu'
import type {
  Context,
  FrameSource,
  InitializationArg,
  InitializationOptions,
  ReGpu,
  Texture
} from '@filonik/regpu'
import type { XRGPUBindingConstructor } from './webgpu'

export type * from '@filonik/regpu'
export { loadImageBitmap, loadImageBitmaps } from '@filonik/regpu'

// TODO
function createTextureResource(
  texture: GPUTexture,
  viewDescriptor?: GPUTextureViewDescriptor
): Texture {
  const defaultView = texture.createView(viewDescriptor)

  return {
    _gpu: texture,
    view(descriptor) {
      return descriptor ? texture.createView(descriptor) : defaultView
    },
    destroy() {
      texture.destroy()
    }
  }
}

export type XRInitializationOptions = InitializationOptions & {
  mode?: 'immersive-vr'
}

export type XRInitializationArg = InitializationArg | XRInitializationOptions

export type XRContext = Context & {
  viewport: { x: number; y: number; width: number; height: number }
  colorAttachment: Texture
  depthAttachment: Texture
  projection: Float32Array
  view: Float32Array
  xrFrame: XRFrame
  xrView: XRView
}

export type XRFrameCallback = (context: XRContext) => void

/** Tick context shared by canvas and XR scheduling; view data comes from perView. */
export type XRFrameContext = Context & { xrFrame?: XRFrame }
export type FrameCallback = (context: XRFrameContext) => void

export type XRSessionState = 'idle' | 'entering' | 'entered' | 'exiting'
export type XRLifecycleHook = () => void
export type XRErrorHook = (error: unknown) => void

export interface ReGpuXr extends ReGpu {
  readonly state: XRSessionState
  onBeforeEnter(cb: XRLifecycleHook): () => void
  onEntered(cb: XRLifecycleHook): () => void
  /** Runs for helper-requested exits; WebXR has no before-end event for external exits. */
  onBeforeExit(cb: XRLifecycleHook): () => void
  onExited(cb: XRLifecycleHook): () => void
  onError(cb: XRErrorHook): () => void
  isSupported(): Promise<boolean>
  submit(cb: FrameCallback): void
  /** Register once-per-tick work, switching between window and XR session timing. */
  frame(cb: FrameCallback, source?: FrameSource): () => void
  perCanvas(cb: FrameCallback): void
  /** Iterate the current XR pose's views synchronously; does nothing outside an XR tick. */
  perView(cb: XRFrameCallback): void
  /** Schedule per-canvas rendering outside XR; resumed after exit or failed entry. */
  canvasFrame(cb: FrameCallback): () => void
  /** Schedule per-view rendering without requesting a session. */
  viewFrame(cb: XRFrameCallback): () => void
  /** Alias for viewFrame. */
  xrFrame(cb: XRFrameCallback): () => void
  enter(): Promise<void>
  exit(): Promise<void>
}

function getAPIs() {
  const xr = typeof navigator === 'undefined' ? undefined : navigator.xr
  const Binding = (
    globalThis as typeof globalThis & {
      XRGPUBinding?: XRGPUBindingConstructor
    }
  ).XRGPUBinding
  if (
    typeof xr?.isSessionSupported !== 'function' ||
    typeof xr.requestSession !== 'function' ||
    typeof Binding !== 'function' ||
    typeof Binding.prototype?.createProjectionLayer !== 'function' ||
    typeof Binding.prototype?.getViewSubImage !== 'function'
  )
    return undefined
  return { xr, Binding }
}

/** Create a ReGpu instance with XR support and managed canvas/XR rendering. */
export async function createREGPU(arg: XRInitializationArg): Promise<ReGpuXr> {
  let options: XRInitializationOptions
  if (typeof arg === 'string') {
    const elements = document.querySelectorAll<HTMLElement>(arg)
    options =
      elements.length === 1 && elements[0].nodeName.toLowerCase() !== 'canvas'
        ? { container: elements[0] }
        : { canvas: arg }
  } else if ('nodeName' in arg) {
    options =
      arg.nodeName.toLowerCase() === 'canvas'
        ? { canvas: arg as HTMLCanvasElement }
        : { container: arg }
  } else if (Symbol.iterator in arg) {
    options = { canvas: arg }
  } else {
    options = arg
  }
  const regpu = await createCoreREGPU({ ...options, xrCompatible: true })
  return addXR(regpu, options)
}

/** Coordinate a canvas fallback with XR rendering. Call enter directly from a user gesture. */
function addXR(regpu: ReGpu, options: XRInitializationOptions): ReGpuXr {
  const context = (regpu as ReGpu & { _context: Context })._context
  const scheduleFrame = regpu.frame.bind(regpu)
  const submit = regpu.submit.bind(regpu)
  const perCanvas = regpu.perCanvas.bind(regpu)
  let state: XRSessionState = 'idle'
  let active:
    | {
        entryFinished: Promise<void>
        exit(): Promise<void>
      }
    | undefined
  const callbacks = new Set<{ callback: FrameCallback }>()
  let stopFrame: (() => void) | undefined
  let source: FrameSource | undefined
  let currentFrame: XRFrame | undefined
  let iterateViews: ((callback: XRFrameCallback) => void) | undefined
  const hooks = {
    beforeEnter: new Set<{ callback: XRLifecycleHook }>(),
    entered: new Set<{ callback: XRLifecycleHook }>(),
    beforeExit: new Set<{ callback: XRLifecycleHook }>(),
    exited: new Set<{ callback: XRLifecycleHook }>(),
    error: new Set<{ callback: XRErrorHook }>()
  }

  function register<T>(callbacks: Set<{ callback: T }>, callback: T) {
    const registration = { callback }
    callbacks.add(registration)
    return () => {
      callbacks.delete(registration)
    }
  }

  function reportHookError(error: unknown) {
    // Observer failures must not interrupt session cleanup or other observers.
    if (typeof globalThis.reportError === 'function') globalThis.reportError(error)
    else console.error(error)
  }

  function emit(event: keyof typeof hooks, error?: unknown) {
    for (const { callback } of [...hooks[event]]) {
      try {
        const result = callback(error)
        // Hooks are notifications, not awaited transition guards.
        void Promise.resolve(result).catch(reportHookError)
      } catch (error) {
        reportHookError(error)
      }
    }
  }

  function fail(error: Error): never {
    emit('error', error)
    throw error
  }

  function pauseFrames() {
    stopFrame?.()
    stopFrame = undefined
  }

  function resumeFrames() {
    if (stopFrame || !callbacks.size || (active && !source)) return
    stopFrame = scheduleFrame((context) => {
      try {
        const tick = { ...context, xrFrame: currentFrame }
        for (const entry of [...callbacks]) {
          if (callbacks.has(entry)) entry.callback(tick)
        }
      } catch (error) {
        stopFrame = undefined
        if (active) {
          emit('error', error)
          void active.exit().catch(() => {})
        } else callbacks.clear()
        throw error
      }
    }, source)
  }

  function frame(callback: FrameCallback, customSource?: FrameSource) {
    if (customSource) return scheduleFrame(callback, customSource)
    const registration = { callback }
    callbacks.add(registration)
    resumeFrames()
    return () => {
      callbacks.delete(registration)
      if (!callbacks.size) pauseFrames()
    }
  }

  function viewFrame(callback: XRFrameCallback) {
    let stopped = false
    const stop = frame(() => {
      api.perView((context) => {
        if (!stopped) callback(context)
      })
    })
    return () => {
      stopped = true
      stop()
    }
  }

  const mode = options.mode ?? 'immersive-vr'
  const api: Omit<ReGpuXr, keyof ReGpu> &
    Pick<ReGpuXr, 'submit' | 'frame' | 'perCanvas' | 'canvasFrame'> = {
    get state() {
      return state
    },
    onBeforeEnter: (cb) => register(hooks.beforeEnter, cb),
    onEntered: (cb) => register(hooks.entered, cb),
    onBeforeExit: (cb) => register(hooks.beforeExit, cb),
    onExited: (cb) => register(hooks.exited, cb),
    onError: (cb) => register(hooks.error, cb),
    async isSupported() {
      const apis = getAPIs()
      if (!apis) return false
      try {
        return await apis.xr.isSessionSupported(mode)
      } catch {
        return false
      }
    },
    submit: (callback) => submit((context) => callback({ ...context, xrFrame: currentFrame })),
    frame,
    perCanvas: (callback) =>
      perCanvas((context) => callback({ ...context, xrFrame: currentFrame })),
    perView: (callback) => iterateViews?.(callback),
    canvasFrame(callback) {
      let stopped = false
      const stop = frame(() => {
        if (active) return
        api.perCanvas((context) => {
          if (!stopped) callback(context)
        })
      })
      return () => {
        stopped = true
        stop()
      }
    },
    viewFrame,
    xrFrame: viewFrame,
    async enter() {
      if (active) fail(new Error('An XR session is already entering or active'))
      const apis = getAPIs()
      if (!apis) fail(new Error('WebXR with WebGPU is unsupported'))

      let current: XRSession | undefined
      let entering = true
      let ended = false
      let beforeExit = false
      let exitPromise: Promise<void> | undefined
      let layer: XRProjectionLayer | undefined
      const depths: Texture[] = []
      let finishEntry!: () => void
      const entryFinished = new Promise<void>((resolve) => {
        finishEntry = resolve
      })

      function settle() {
        if (active !== transition) return
        active = undefined
        state = 'idle'
        resumeFrames()
        if (current) emit('exited')
      }

      function cleanup() {
        if (ended) return
        ended = true
        pauseFrames()
        source = undefined
        iterateViews = undefined
        depths.splice(0).forEach((depth) => depth.destroy())
        layer?.destroy?.()
        current?.removeEventListener('end', cleanup)
        // Keep entry locked until its outstanding setup work has settled.
        if (!entering) settle()
      }

      const transition = {
        entryFinished,
        exitRequested: false,
        exit(): Promise<void> {
          if (ended) return Promise.resolve()
          if (exitPromise) return exitPromise
          transition.exitRequested = true
          state = 'exiting'
          // Store the promise before notifying hooks, which may call exit again.
          let resolveExit!: () => void
          let rejectExit!: (error: unknown) => void
          if (current) {
            exitPromise = new Promise<void>((resolve, reject) => {
              resolveExit = resolve
              rejectExit = reject
            })
          }
          if (!beforeExit) {
            beforeExit = true
            emit('beforeExit')
          }
          if (!current) return entryFinished
          const result = exitPromise!
          void (async () => {
            try {
              await current!.end()
              cleanup()
              resolveExit()
            } catch (error) {
              exitPromise = undefined
              beforeExit = false
              transition.exitRequested = false
              if (!ended) state = entering ? 'entering' : 'entered'
              emit('error', error)
              rejectExit(error)
            }
          })()
          return result
        }
      }
      active = transition
      state = 'entering'
      pauseFrames()
      emit('beforeEnter')
      try {
        if (transition.exitRequested) throw new Error('XR entry was cancelled')
        // Request the session synchronously from enter to preserve user activation.
        current = await apis.xr.requestSession(mode, {
          requiredFeatures: ['webgpu'],
          optionalFeatures: ['local-floor']
        })
        current.addEventListener('end', cleanup, { once: true })
        const session = current
        try {
          if (transition.exitRequested) throw new Error('XR entry was cancelled')
          if (
            typeof session.requestReferenceSpace !== 'function' ||
            typeof session.updateRenderState !== 'function' ||
            typeof session.requestAnimationFrame !== 'function' ||
            typeof session.cancelAnimationFrame !== 'function' ||
            typeof session.end !== 'function'
          )
            throw new Error('The XR session API is incomplete')

          const space = await session.requestReferenceSpace('local-floor').catch(() => {
            if (ended) throw new Error('XR session ended during entry')
            return session.requestReferenceSpace('local')
          })
          if (ended || transition.exitRequested) throw new Error('XR session ended during entry')
          const { device, format } = context
          const binding = new apis.Binding(session, device)
          // Match the existing scene pipelines' color format; no external depth allocation.
          layer = binding.createProjectionLayer({ colorFormat: format })
          if (typeof layer.destroy !== 'function') throw new Error('The XR layer API is incomplete')
          session.updateRenderState({ layers: [layer] })
          const projectionLayer = layer
          source = {
            request: (callback) =>
              session.requestAnimationFrame((time, nextFrame) => {
                currentFrame = nextFrame
                try {
                  callback(time)
                } finally {
                  currentFrame = undefined
                }
              }),
            cancel: (handle) => session.cancelAnimationFrame(handle)
          }
          iterateViews = (callback) => {
            const frame = currentFrame
            if (!frame || ended || transition.exitRequested) return
            const pose = frame.getViewerPose(space)
            if (!pose) return
            pose.views.forEach((xrView, index) => {
              if (ended || transition.exitRequested) return
              const image = binding.getViewSubImage(projectionLayer, xrView)
              if (typeof image.getViewDescriptor !== 'function') {
                throw new Error('The XR subimage API is incomplete')
              }
              const { width, height } = image.colorTexture
              let depthAttachment = depths[index]
              if (
                !depthAttachment ||
                depthAttachment._gpu.width !== width ||
                depthAttachment._gpu.height !== height
              ) {
                depthAttachment?.destroy()
                depthAttachment = depths[index] = regpu.texture({
                  shape: [width, height],
                  format: 'depth24plus',
                  usage: GPUTextureUsage.RENDER_ATTACHMENT
                })
              }
              const colorAttachment = createTextureResource(
                image.colorTexture,
                image.getViewDescriptor()
              )
              callback({
                ...context,
                projection: xrView.projectionMatrix,
                view: xrView.transform.inverse.matrix,
                colorAttachment,
                depthAttachment,
                viewport: image.viewport,
                xrFrame: frame,
                xrView
              })
            })
          }
          if (ended || transition.exitRequested) throw new Error('XR session ended during entry')
          state = 'entered'
          resumeFrames()
          emit('entered')
        } catch (error) {
          if (!ended) {
            await transition.exit().catch(() => {})
            cleanup()
          }
          throw error
        }
      } catch (error) {
        entering = false
        settle()
        emit('error', error)
        throw error
      } finally {
        entering = false
        if (ended) settle()
        finishEntry()
      }
    },
    async exit() {
      const transition = active
      await transition?.exit()
      await transition?.entryFinished
    }
  }
  // Preserve accessors such as state while extending scheduling and target iteration.
  return Object.defineProperties(regpu, Object.getOwnPropertyDescriptors(api)) as ReGpuXr
}
