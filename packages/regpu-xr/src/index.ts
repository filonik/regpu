/// <reference types="@webgpu/types" preserve="true" />
/// <reference types="webxr" preserve="true" />

import { createREGPU as createCoreREGPU } from '@filonik/regpu'
import type {
  Context,
  FrameContext,
  FrameSource,
  InitializationArg,
  InitializationOptions,
  ReGpu,
  Texture
} from '@filonik/regpu'
import type { XRGPUBindingConstructor } from './webgpu'
import { createSwitchableFrameSource } from './frame-source'

export type * from '@filonik/regpu'
export { loadImageBitmap, loadImageBitmaps, windowFrameSource } from '@filonik/regpu'

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

export type XRViewContext = Context & {
  viewport: { x: number; y: number; width: number; height: number }
  colorAttachment: Texture
  depthAttachment: Texture
  projection: Float32Array
  view: Float32Array
  xrFrame: XRFrame
  xrView: XRView
}

/** Tick context with explicit canvas targets and the current tracked XR views. */
export type XRFrameContext = FrameContext & {
  xrFrame?: XRFrame
  /** Empty outside an XR tick or when the viewer pose is unavailable. */
  readonly viewContexts: readonly XRViewContext[]
}
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
  /** XR timing only; dormant outside a ready session. */
  readonly xrFrameSource: FrameSource
  /** Window/XR handover; paused during entry and exit. */
  readonly hybridFrameSource: FrameSource
  /** One synchronous callback per source; defaults to window timing. */
  frame(cb: FrameCallback, source?: FrameSource): () => void
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

/** Create a ReGpu instance with XR controls and explicit frame sources. */
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

/** Add XR sources and view contexts. Call enter directly from a user gesture. */
function addXR(regpu: ReGpu, options: XRInitializationOptions): ReGpuXr {
  const context = (regpu as ReGpu & { _context: Context })._context
  const scheduleFrame = regpu.frame.bind(regpu)
  const submit = regpu.submit.bind(regpu)
  let state: XRSessionState = 'idle'
  let active:
    | {
        entryFinished: Promise<void>
        exit(): Promise<void>
      }
    | undefined
  const xrTiming = createSwitchableFrameSource()
  const hybridTiming = createSwitchableFrameSource(regpu.windowFrameSource)
  let sessionSource: FrameSource | undefined
  let currentFrame: XRFrame | undefined
  let createViewContexts: ((context: FrameContext) => readonly XRViewContext[]) | undefined
  let currentViews: readonly XRViewContext[] | undefined
  const emptyViews: readonly XRViewContext[] = []
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

  function refreshSources() {
    const ready = state === 'entered' ? sessionSource : undefined
    xrTiming.setSource(ready)
    hybridTiming.setSource(active ? ready : regpu.windowFrameSource)
  }

  function withXR(context: FrameContext, xrFrame: XRFrame | undefined): XRFrameContext {
    return {
      ...context,
      xrFrame,
      get viewContexts() {
        return xrFrame ? (currentViews ??= createViewContexts?.(context) ?? emptyViews) : emptyViews
      }
    }
  }

  function frame(callback: FrameCallback, source = regpu.windowFrameSource) {
    const timing =
      source === xrTiming.source
        ? xrTiming
        : source === hybridTiming.source
          ? hybridTiming
          : undefined
    let version = -1
    return scheduleFrame((frameContext) => {
      if (timing && version !== timing.version) {
        version = timing.version
        context.delta = frameContext.delta = 0
      }
      try {
        callback(withXR(frameContext, timing ? currentFrame : undefined))
      } catch (error) {
        emit('error', error)
        if (timing && currentFrame && active) void active.exit().catch(() => {})
        throw error
      }
    }, source)
  }

  const mode = options.mode ?? 'immersive-vr'
  const api: Omit<ReGpuXr, keyof ReGpu> & Pick<ReGpuXr, 'submit' | 'frame'> = {
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
    submit: (callback) => submit((context) => callback(withXR(context, currentFrame))),
    frame,
    xrFrameSource: xrTiming.source,
    hybridFrameSource: hybridTiming.source,
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
        refreshSources()
        if (current) emit('exited')
      }

      function cleanup() {
        if (ended) return
        ended = true
        sessionSource = undefined
        refreshSources()
        createViewContexts = undefined
        currentViews = undefined
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
          refreshSources()
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
              refreshSources()
              emit('error', error)
              rejectExit(error)
            }
          })()
          return result
        }
      }
      active = transition
      state = 'entering'
      refreshSources()
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
          sessionSource = {
            request: (callback) =>
              session.requestAnimationFrame((time, nextFrame) => {
                const previousFrame = currentFrame
                const previousViews = currentViews
                currentFrame = nextFrame
                currentViews = undefined
                try {
                  callback(time)
                } finally {
                  currentFrame = previousFrame
                  currentViews = previousViews
                }
              }),
            cancel: (handle) => session.cancelAnimationFrame(handle)
          }
          createViewContexts = (frameContext) => {
            const frame = currentFrame
            if (!frame || ended || transition.exitRequested) return []
            const pose = frame.getViewerPose(space)
            if (!pose) return []
            return pose.views.map((xrView, index) => {
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
              return {
                ...context,
                time: frameContext.time,
                delta: frameContext.delta,
                projection: xrView.projectionMatrix,
                view: xrView.transform.inverse.matrix,
                colorAttachment,
                depthAttachment,
                viewport: image.viewport,
                xrFrame: frame,
                xrView
              }
            })
          }
          if (ended || transition.exitRequested) throw new Error('XR session ended during entry')
          state = 'entered'
          refreshSources()
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
  // Preserve accessors such as state while extending scheduling and target contexts.
  return Object.defineProperties(regpu, Object.getOwnPropertyDescriptors(api)) as ReGpuXr
}
