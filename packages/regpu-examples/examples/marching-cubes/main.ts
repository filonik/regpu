// This example is based on: https://github.com/tcoppex/webgpu-marchingcubes
// Copyright 2024 Thibault Coppex and distributed under the MIT License.

import { createREGPU, loadImageBitmaps } from '@filonik/regpu'
import { mat4 } from 'wgpu-matrix'

import generateWGSL from './marching-cubes.wgsl?raw'
import renderWGSL from './render.wgsl?raw'

import createCamera from './camera'

const getTextureUrl = (name: string) => new URL(`./textures/${name}`, import.meta.url).href
const loadTextures = (names: string[]) => loadImageBitmaps(names.map(getTextureUrl))

const RESOLUTION = 28
const CELL_COUNT = RESOLUTION ** 3
const MAX_VERTICES = CELL_COUNT * 36
const WORKGROUP_SIZE = 64

const canvas = document.querySelector('canvas')!
const regpu = await createREGPU(canvas)
const [groundImage, mudImage, rockImage, groundNormalImage, mudNormalImage, rockNormalImage] =
  await loadTextures([
    'coast_sand_rocks_02_diff_1k.jpg',
    'mud_cracked_dry_03_diff_1k.jpg',
    'rock_face_03_diff_1k.jpg',
    'coast_sand_rocks_02_nor_gl_1k.png',
    'mud_cracked_dry_03_nor_gl_1k.png',
    'rock_face_03_nor_gl_1k.png'
  ])
const ground = regpu.texture({ data: groundImage, format: 'rgba8unorm-srgb' })
const mud = regpu.texture({ data: mudImage, format: 'rgba8unorm-srgb' })
const rock = regpu.texture({ data: rockImage, format: 'rgba8unorm-srgb' })
const groundNormal = regpu.texture({ data: groundNormalImage })
const mudNormal = regpu.texture({ data: mudNormalImage })
const rockNormal = regpu.texture({ data: rockNormalImage })
const materialSampler = regpu.sampler({
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'repeat',
  addressModeV: 'repeat'
})
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

const renderPass = regpu.render.pass({
  clear: { color: [0.025, 0.055, 0.09, 1], depth: 1 }
})
const drawSurface = regpu.render<{ scene: Record<string, ArrayLike<number>> }>({
  pipeline: {
    module: renderWGSL,
    primitive: { topology: 'triangle-list' }
  },
  indirect: drawArgs,
  uniforms: (props) => ({ scene: props.scene }),
  buffers: { vertices },
  textures: { ground, mud, rock, groundNormal, mudNormal, rockNormal },
  samplers: { materialSampler }
})

const camera = createCamera(canvas, { distance: 5.2, autoRotateSpeed: 0.12 })
const resetVertexCount = new Uint32Array([0])

regpu.frame(({ device, time, delta }) => {
  camera.tick(delta)
  device.queue.writeBuffer(drawArgs._gpu, 0, resetVertexCount)

  computePass(() => {
    generateSurface({ values: [time, RESOLUTION, 4, MAX_VERTICES] })
  })

  const projection = mat4.perspective((50 * Math.PI) / 180, canvas.width / canvas.height, 0.1, 30)
  const viewProjection = mat4.multiply(projection, camera.view())
  renderPass(() => {
    drawSurface({
      scene: {
        viewProjection,
        eye: [...camera.eye(), 1]
      }
    })
  })
})

setTimeout(() => {
  document.querySelector<HTMLElement>('#hint')!.style.opacity = '0'
}, 4000)
