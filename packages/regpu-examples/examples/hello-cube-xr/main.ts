import {
  createREGPU,
  type CanvasContext,
  type UniformStruct,
  type XRViewContext
} from '@filonik/regpu-xr'
import createCamera from './camera'

import helloCubeCode from './helloCube.wgsl?raw'

import { mat4 } from 'wgpu-matrix'

// prettier-ignore
const cube = {
  position: [
    [-0.5, +0.5, +0.5], [+0.5, +0.5, +0.5], [+0.5, -0.5, +0.5], [-0.5, -0.5, +0.5], // positive z face.
    [+0.5, +0.5, +0.5], [+0.5, +0.5, -0.5], [+0.5, -0.5, -0.5], [+0.5, -0.5, +0.5], // positive x face
    [+0.5, +0.5, -0.5], [-0.5, +0.5, -0.5], [-0.5, -0.5, -0.5], [+0.5, -0.5, -0.5], // negative z face
    [-0.5, +0.5, -0.5], [-0.5, +0.5, +0.5], [-0.5, -0.5, +0.5], [-0.5, -0.5, -0.5], // negative x face.
    [-0.5, +0.5, -0.5], [+0.5, +0.5, -0.5], [+0.5, +0.5, +0.5], [-0.5, +0.5, +0.5], // top face
    [-0.5, -0.5, -0.5], [+0.5, -0.5, -0.5], [+0.5, -0.5, +0.5], [-0.5, -0.5, +0.5] // bottom face
  ],
  texCoord: [
    [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], // positive z face.
    [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], // positive x face.
    [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], // negative z face.
    [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], // negative x face.
    [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], // top face
    [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0] // bottom face
  ],
  index: [
    [2, 1, 0], [2, 0, 3], // positive z face.
    [6, 5, 4], [6, 4, 7], // positive x face.
    [10, 9, 8], [10, 8, 11], // negative z face.
    [14, 13, 12], [14, 12, 15], // negative x face.
    [18, 17, 16], [18, 16, 19], // top face.
    [20, 21, 22], [23, 20, 22] // bottom face
  ]
}

// WIP: Experimental WebXR support
const canvas = document.querySelector('canvas')!
const regpu = await createREGPU({ canvas, mode: 'immersive-vr' })

const canvasPass = regpu.render.pass<CanvasContext>({
  colorAttachments: ({ colorAttachment }) => [colorAttachment],
  depthAttachment: ({ depthAttachment }) => depthAttachment
})
const xrPass = regpu.render.pass<XRViewContext>({
  colorAttachments: ({ colorAttachment }) => [colorAttachment],
  depthAttachment: ({ depthAttachment }) => depthAttachment,
  viewport: ({ viewport }) => viewport
})
const withSolidPipeline = regpu.render<{ u: UniformStruct }>({
  pipeline: helloCubeCode,
  uniforms: (props) => ({ u: props.u })
})
const drawCube = regpu.render({
  attributes: {
    position: cube.position,
    texCoord: cube.texCoord
  },
  indices: cube.index
})

const camera = createCamera(canvas, {
  azimuth: Math.PI / 2,
  elevation: Math.PI / 4,
  distance: 5,
  minDistance: 3,
  maxDistance: 60,
  target: [0, 1.5, -2.5]
})

const projection = mat4.create()
const view = mat4.create()
const model = mat4.create()

const draw = (u: UniformStruct) => {
  return () => {
    withSolidPipeline({ u }, () => {
      drawCube()
    })
  }
}

// Choose window/XR handover explicitly; update the scene once before drawing targets.
regpu.frame(({ time, delta, canvasContexts, viewContexts, xrFrame }) => {
  mat4.translation([0, 1.5, -2.5], model)
  mat4.rotateY(model, time, model)

  if (xrFrame) {
    viewContexts.forEach((context) => {
      const { projection, view } = context
      xrPass(context, draw({ projection, view, model }))
    })
  } else {
    camera.tick(delta)
    canvasContexts.forEach((context) => {
      const { canvas } = context
      camera.view(view)
      mat4.perspective(Math.PI / 4, canvas.width / canvas.height, 0.01, 100, projection)
      canvasPass(context, draw({ projection, view, model }))
    })
  }
}, regpu.hybridFrameSource)

const button = document.querySelector<HTMLButtonElement>('#enter-xr')!
const status = document.querySelector<HTMLElement>('#xr-status')!

function syncButton() {
  button.disabled = regpu.state === 'entering' || regpu.state === 'exiting'
  button.textContent = {
    idle: 'Enter XR',
    entering: 'Entering XR…',
    entered: 'Exit XR',
    exiting: 'Exiting XR…'
  }[regpu.state]
}

regpu.onBeforeEnter(() => {
  status.textContent = ''
  syncButton()
})
regpu.onEntered(syncButton)
regpu.onBeforeExit(syncButton)
regpu.onExited(syncButton)
regpu.onError((error) => {
  status.textContent = error instanceof Error ? error.message : 'XR session failed'
  syncButton()
})

button.addEventListener('click', () => {
  // Enter XR directly from the click handler to preserve user activation.
  const transition = regpu.state === 'entered' ? regpu.exit() : regpu.enter()
  // The lifecycle hooks handle UI updates and errors for every entry/exit path.
  void transition.catch(() => {})
})

if (await regpu.isSupported()) button.hidden = false
