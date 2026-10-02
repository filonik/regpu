import { createREGPU } from '@filonik/regpu'

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

const regpu = await createREGPU('canvas')

const renderPass = regpu.render.pass({})
const withSolidPipeline = regpu.render<{ u: Record<string, ArrayLike<number>> }>({
  pipeline: {
    module: helloCubeCode
    /*
    attributes: {
      position: 'vec3f',
      texCoord: 'vec2f'
    },
    uniforms: {
      u: {
        group: 0,
        binding: 0,
        type: {
          projection: 'mat4x4f',
          view: 'mat4x4f',
          model: 'mat4x4f'
        },
      },
    },
    */
  },
  uniforms: (props) => ({ u: props.u })
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
        u: {
          projection,
          view,
          model
        }
      },
      () => {
        drawCube()
      }
    )
  })
})
