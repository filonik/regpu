// This example is based on: https://github.com/mikolalysenko/regl/blob/gh-pages/example/metaball.js

import { createREGPU, loadImageBitmap } from '@filonik/regpu'
import { mat4 } from 'wgpu-matrix'

import backgroundWGSL from './background.wgsl?raw'
import generateWGSL from './metaball.wgsl?raw'
import renderWGSL from './render.wgsl?raw'

import createCamera from './camera'

const RESOLUTION = 48
const CELL_COUNT = RESOLUTION ** 3
const MAX_VERTICES = CELL_COUNT * 36
const WORKGROUP_SIZE = 64

const canvas = document.querySelector('canvas')!
const regpu = await createREGPU(canvas)
const vertices = regpu.buffer({ size: MAX_VERTICES * 32 })
const drawArgs = regpu.buffer({
  data: new Uint32Array([0, 1, 0, 0]),
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST
})

const computePass = regpu.compute.pass({})
const generateSurface = regpu.compute<{ values: ArrayLike<number> }>({
  pipeline: generateWGSL,
  count: Math.ceil(CELL_COUNT / WORKGROUP_SIZE),
  uniforms: (props) => ({ params: { values: props.values } }),
  buffers: { vertices, drawArgs }
})

const environment = regpu.texture({
  data: await loadImageBitmap('/textures/spheretexture.jpg')
})
const normalMap = regpu.texture({
  data: await loadImageBitmap('/textures/normaltexture.jpg')
})
const environmentSampler = regpu.sampler({ magFilter: 'linear', minFilter: 'linear' })
const normalSampler = regpu.sampler({
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'repeat',
  addressModeV: 'repeat'
})

const renderPass = regpu.render.pass({ clear: { color: [0.14, 0.27, 0.41, 1], depth: 1 } })
const drawBackground = regpu.render<{ values: ArrayLike<number> }>({
  pipeline: {
    module: backgroundWGSL,
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'always'
    }
  },
  count: 3,
  uniforms: (props) => ({ background: { values: props.values } })
})
const drawSurface = regpu.render<{ scene: Record<string, ArrayLike<number>> }>({
  pipeline: renderWGSL,
  indirect: drawArgs,
  uniforms: (props) => ({ scene: props.scene }),
  buffers: { vertices },
  textures: { environment, normalMap },
  samplers: { environmentSampler, normalSampler }
})

const camera = createCamera(canvas, {
  azimuth: 1,
  elevation: 0.3,
  distance: 1.5,
  minDistance: 0.5,
  maxDistance: 3,
  autoRotateSpeed: 0.08,
  target: [1, 1, 1]
})
const resetVertexCount = new Uint32Array([0])

regpu.frame(({ device, time, delta }) => {
  camera.tick(delta)
  device.queue.writeBuffer(drawArgs._gpu, 0, resetVertexCount)

  computePass(() => {
    generateSurface({ values: [time * 0.5, RESOLUTION, MAX_VERTICES, 0] })
  })

  const projection = mat4.perspective((45 * Math.PI) / 180, canvas.width / canvas.height, 0.01, 10)
  renderPass(() => {
    drawBackground({ values: [canvas.width, canvas.height, 0.05, 0] })
    drawSurface({
      scene: {
        projection,
        view: camera.view(),
        color: [36 / 255, 70 / 255, 106 / 255, 1]
      }
    })
  })
})

setTimeout(() => {
  document.querySelector<HTMLElement>('#hint')!.style.opacity = '0'
}, 4000)
