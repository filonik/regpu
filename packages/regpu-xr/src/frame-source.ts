import type { FrameSource } from '@filonik/regpu'

/** Keep one-shot requests alive while their clock is paused or replaced. */
export function createSwitchableFrameSource(initialSource?: FrameSource) {
  type Request = {
    callback: FrameRequestCallback
    source?: FrameSource
    handle?: number
  }
  let current = initialSource
  let version = 0
  let nextHandle = 0
  const pending = new Map<number, Request>()

  function schedule(handle: number, request: Request) {
    if (!current) return
    const requestedVersion = version
    request.source = current
    request.handle = current.request((time) => {
      if (version !== requestedVersion || pending.get(handle) !== request) return
      pending.delete(handle)
      request.handle = undefined
      request.callback(time)
    })
  }

  function cancel(request: Request) {
    const { source, handle } = request
    request.source = undefined
    request.handle = undefined
    if (handle !== undefined) source!.cancel(handle)
  }

  const source: FrameSource = {
    request(callback) {
      const handle = nextHandle++
      const request = { callback }
      pending.set(handle, request)
      try {
        schedule(handle, request)
      } catch (error) {
        pending.delete(handle)
        throw error
      }
      return handle
    },
    cancel(handle) {
      const request = pending.get(handle)
      if (!request) return
      pending.delete(handle)
      cancel(request)
    }
  }

  return {
    source,
    get version() {
      return version
    },
    setSource(next?: FrameSource) {
      if (current === next) return
      current = next
      version++
      for (const [handle, request] of pending) {
        cancel(request)
        schedule(handle, request)
      }
    }
  }
}
