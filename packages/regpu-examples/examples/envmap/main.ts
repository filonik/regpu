// This example is based on: https://github.com/mikolalysenko/regl/blob/gh-pages/example/envmap.js

import { createREGPU, loadImageBitmaps } from '@filonik/regpu'
import { mat4 } from 'wgpu-matrix'

import createCamera from './camera'
import backgroundCode from './background.wgsl?raw'
import envmapCode from './envmap.wgsl?raw'

import angleNormals from 'angle-normals'
import bunny from 'bunny'

const canvas = document.querySelector('canvas')!

const regpu = await createREGPU(canvas)
const cubemap = regpu.texture({
  data: await loadImageBitmaps([
    '/posx.jpg',
    '/negx.jpg',
    '/posy.jpg',
    '/negy.jpg',
    '/posz.jpg',
    '/negz.jpg'
  ]),
  view: { dimension: 'cube' }
})
const sampler = regpu.sampler({ magFilter: 'linear', minFilter: 'linear' })

const withEnvironment = regpu.render({
  textures: { environment: cubemap },
  samplers: { environmentSampler: sampler }
})
const renderPass = regpu.render.pass({})

const view = mat4.create()
const inverseView = mat4.create()
const projection = mat4.create()

const camera = createCamera(canvas, {
  azimuth: Math.PI / 2,
  elevation: 0,
  distance: 30,
  minDistance: 3,
  maxDistance: 60,
  autoRotateSpeed: 1,
  target: [0, 2.5, 0]
})

const drawBackground = regpu.render({
  pipeline: {
    module: backgroundCode,
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'always'
    }
  },
  attributes: {
    position: [
      [-4, -4],
      [-4, 4],
      [8, 0]
    ]
  },
  uniforms: () => ({ camera: { view } }),
  count: 3
})

const drawBunny = regpu.render({
  pipeline: envmapCode,
  attributes: {
    position: bunny.positions,
    normal: angleNormals(bunny.cells, bunny.positions)
  },
  indices: bunny.cells,
  uniforms: () => ({ camera: { projection, view, inverseView } })
})

regpu.frame(({ canvas, delta }) => {
  camera.tick(delta)
  camera.view(view)
  mat4.inverse(view, inverseView)
  mat4.perspective(Math.PI / 4, canvas.width / canvas.height, 0.01, 1000, projection)

  renderPass(() => {
    withEnvironment(() => {
      drawBackground()
      drawBunny()
    })
  })
})
