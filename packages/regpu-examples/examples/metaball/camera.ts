import { mat4 } from 'wgpu-matrix'

export interface OrbitCameraOptions {
  rotate?: boolean
  scale?: boolean
  azimuth?: number
  elevation?: number
  distance?: number
  minElevation?: number
  maxElevation?: number
  minDistance?: number
  maxDistance?: number
  rotateSpeed?: number
  zoomSpeed?: number
  autoRotate?: boolean
  autoRotateSpeed?: number
  target?: ArrayLike<number>
}

export interface OrbitCamera {
  azimuth: number
  elevation: number
  distance: number
  autoRotate: boolean
  tick(delta?: number): void
  view(out?: Float32Array): Float32Array
  eye(out?: Float32Array): Float32Array
  dispose(): void
}

interface PointerPosition {
  x: number
  y: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/**
 * Creates an orbit camera and attaches its input handlers to a canvas.
 *
 * Drag with a mouse or one finger to orbit. Use the wheel or pinch with two
 * fingers to zoom. Call `tick` once per frame before reading the view matrix.
 */
export default function createCamera(
  canvas: HTMLCanvasElement,
  options: OrbitCameraOptions = {}
): OrbitCamera {
  const minElevation = options.minElevation ?? -1.4
  const maxElevation = options.maxElevation ?? 1.4
  const minDistance = options.minDistance ?? 1.5
  const maxDistance = options.maxDistance ?? 20
  const rotateSpeed = options.rotateSpeed ?? 0.005
  const zoomSpeed = options.zoomSpeed ?? 0.001
  const rotate = options.rotate ?? true
  const scale = options.scale ?? true
  const autoRotateSpeed = options.autoRotateSpeed ?? 0.05
  const target = options.target ?? [0, 0, 0]
  const pointers = new Map<number, PointerPosition>()
  const previousTouchAction = canvas.style.touchAction
  let lastPinchDistance: number | undefined
  let disposed = false

  // Without this, browsers turn touch drags and pinches into page gestures and
  // may cancel the pointer stream before the camera can use it.
  canvas.style.touchAction = 'none'

  const camera: OrbitCamera = {
    azimuth: options.azimuth ?? 0.6,
    elevation: clamp(options.elevation ?? 0.35, minElevation, maxElevation),
    distance: clamp(options.distance ?? 6.5, minDistance, maxDistance),
    autoRotate: options.autoRotate ?? true,

    tick(delta = 0) {
      if (camera.autoRotate) camera.azimuth += autoRotateSpeed * delta
    },

    eye(out = new Float32Array(3)) {
      out[0] = target[0] + camera.distance * Math.cos(camera.elevation) * Math.sin(camera.azimuth)
      out[1] = target[1] + camera.distance * Math.sin(camera.elevation)
      out[2] = target[2] + camera.distance * Math.cos(camera.elevation) * Math.cos(camera.azimuth)
      return out
    },

    view(out = new Float32Array(16)) {
      return mat4.lookAt(camera.eye(), target, [0, 1, 0], out)
    },

    dispose() {
      if (disposed) return
      disposed = true
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerEnd)
      canvas.removeEventListener('pointercancel', onPointerEnd)
      canvas.removeEventListener('lostpointercapture', onPointerEnd)
      canvas.removeEventListener('wheel', onWheel)
      canvas.style.touchAction = previousTouchAction
      pointers.clear()
    }
  }

  function pinchDistance() {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : undefined
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (!rotate && (!scale || event.pointerType === 'mouse')) return
    event.preventDefault()
    camera.autoRotate = false
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    lastPinchDistance = pinchDistance()
    canvas.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    event.preventDefault()

    if (rotate && pointers.size === 1) {
      camera.azimuth -= (event.clientX - previous.x) * rotateSpeed
      camera.elevation = clamp(
        camera.elevation + (event.clientY - previous.y) * rotateSpeed,
        minElevation,
        maxElevation
      )
    }

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (scale && pointers.size >= 2) {
      const distance = pinchDistance()
      if (distance && lastPinchDistance) {
        camera.distance = clamp(
          camera.distance * (lastPinchDistance / distance),
          minDistance,
          maxDistance
        )
      }
      lastPinchDistance = distance
    }
  }

  function onPointerEnd(event: PointerEvent) {
    pointers.delete(event.pointerId)
    lastPinchDistance = pinchDistance()
  }

  function onWheel(event: WheelEvent) {
    if (!scale) return
    event.preventDefault()
    camera.autoRotate = false
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
    camera.distance = clamp(
      camera.distance * Math.exp(event.deltaY * deltaScale * zoomSpeed),
      minDistance,
      maxDistance
    )
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerEnd)
  canvas.addEventListener('pointercancel', onPointerEnd)
  canvas.addEventListener('lostpointercapture', onPointerEnd)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  return camera
}
