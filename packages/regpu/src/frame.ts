import type { Context, FrameCallback, FrameSource } from './types'

/** Window timing, shared by the default and explicit window-source forms. */
export const windowFrameSource: FrameSource = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle)
}

export function createFrameScheduler(context: Context, submit: (callback: FrameCallback) => void) {
  const loops = new Map<FrameSource, () => void>()

  return function frame(callback: FrameCallback, source = windowFrameSource) {
    if (loops.has(source)) {
      throw new Error(
        'A frame callback is already active for this source; stop it before starting another'
      )
    }
    let active = true
    let handle: number | undefined
    let generation = 0
    let previousTime: number | undefined

    function stop() {
      if (!active) return
      active = false
      generation++
      if (loops.get(source) === stop) loops.delete(source)
      const pending = handle
      handle = undefined
      if (pending !== undefined) source.cancel(pending)
    }

    function request() {
      const requested = ++generation
      let returned = false
      handle = source.request((ms) => {
        if (!returned)
          throw new Error('FrameSource.request must invoke its callback asynchronously')
        // Cancellation may leave worker messages or other deliveries in flight.
        if (!active || generation !== requested) return
        generation++
        handle = undefined
        context.time = ms * 0.001
        context.delta = previousTime === undefined ? 0 : context.time - previousTime
        previousTime = context.time
        try {
          submit(callback)
          if (active) request()
        } catch (error) {
          stop()
          throw error
        }
      })
      returned = true
    }

    loops.set(source, stop)
    try {
      request()
    } catch (error) {
      stop()
      throw error
    }
    return stop
  }
}
