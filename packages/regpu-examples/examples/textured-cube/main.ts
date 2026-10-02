import { createREGPU, loadImageBitmap, type Uniforms } from '@filonik/regpu'

import texturedCubeCode from './texturedCube.wgsl?raw'

import { mat4 } from 'wgpu-matrix'

import { cube } from './cube'

const regpu = await createREGPU('canvas')

const cubeTexture = regpu.texture({
  data: await loadImageBitmap('/Di-3d.png')
})

const cubeTextureSampler = regpu.sampler({
  magFilter: 'linear',
  minFilter: 'linear'
})

const renderPass = regpu.render.pass({})

const withSolidPipeline = regpu.render<Uniforms>({
  pipeline: texturedCubeCode,
  textures: {
    baseColor: cubeTexture
  },
  samplers: {
    baseColorSampler: cubeTextureSampler
  },
  uniforms: (props) => props
})

const drawCube = regpu.render({
  attributes: {
    position: cube.position,
    texCoord: cube.texCoord
  },
  indices: cube.index
})

const projection = mat4.create()
const view = mat4.create()
const model = mat4.create()

regpu.frame(({ canvas, time }) => {
  mat4.perspective(Math.PI / 4, canvas.width / canvas.height, 0.01, 100, projection)
  mat4.lookAt([2, 2, 2], [0, 0, 0], [0, 1, 0], view)
  mat4.rotation([0, 1, 0], time, model)

  renderPass(() => {
    withSolidPipeline(
      {
        camera: {
          projection,
          view
        },
        model: {
          transform: model
        }
      },
      () => {
        drawCube()
      }
    )
  })
})
