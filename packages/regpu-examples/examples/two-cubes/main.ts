import { createREGPU, type Sampler, type Texture, type UniformStruct } from '@filonik/regpu'

import helloMeshCode from './helloMesh.wgsl?raw'

import { mat4 } from 'wgpu-matrix'

// prettier-ignore
const mesh = {
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

// prettier-ignore
const texture = regpu.texture({
  shape: [2,2],
  data: [
    [127, 127, 127, 255], [63, 63, 63, 255],
    [63, 63, 63, 255], [127, 127, 127, 255],
  ]
})

const sampler = regpu.sampler({
  // TODO
})

const renderPass = regpu.render.pass({})

const withSolidPipeline = regpu.render({
  pipeline: {
    module: helloMeshCode
    // Optional (layout automatically inferred)
    /*
    attributes: {
      position: 'vec3f',
      texCoord: 'vec2f'
    },
    uniforms: {
      camera: {
        group: 0,
        binding: 0,
        type: {
          projection: 'mat4x4f',
          view: 'mat4x4f'
        }
      },
      model: {
        group: 2,
        binding: 0,
        type: {
          transform: 'mat4x4f'
        }
      }
    },
    textures: {
      baseColor: {
        group: 1,
        binding: 0
      }
    },
    samplers: {
      baseColorSampler: {
        group: 1,
        binding: 1
      }
    }
    */
  }
})

const withCamera = regpu.render<UniformStruct>({
  uniforms: (props) => ({
    camera: props
  })
})

const withMaterial = regpu.render<{ baseColor: Texture; baseColorSampler: Sampler }>({
  textures: (props) => ({
    baseColor: props.baseColor
  }),
  samplers: (props) => ({
    baseColorSampler: props.baseColorSampler
  })
})

const withModel = regpu.render<UniformStruct>({
  uniforms: (props) => ({
    model: props
  })
})

const drawMesh = regpu.render({
  attributes: {
    position: mesh.position,
    texCoord: mesh.texCoord
  },
  indices: mesh.index
})

const projection = mat4.create()
const view = mat4.create()

const model0 = mat4.create()
const model1 = mat4.create()

// prettier-ignore
regpu.frame(({ canvas, time }) => {
  mat4.perspective(Math.PI / 4, canvas.width / canvas.height, 0.01, 100, projection)
  mat4.lookAt([2, 2, 2], [0, 0, 0], [0, 1, 0], view)

  mat4.identity(model0)
  mat4.scale(model0, [0.5, 0.5, 0.5], model0)
  mat4.translate(model0, [1, 0, 0], model0)
  mat4.rotate(model0, [1, 0, 0], time, model0)

  mat4.identity(model1)
  mat4.scale(model1, [0.5, 0.5, 0.5], model1)
  mat4.translate(model1, [-1, 0, 0], model1)
  mat4.rotate(model1, [0, 1, 0], time, model1)

  renderPass(() => {
    withSolidPipeline(() => {
      withCamera({
        projection,
        view
      }, () => {
        withMaterial({
          baseColor: texture,
          baseColorSampler: sampler
        }, () => {
          withModel({
            transform: model0
          }, () => {
            drawMesh()
          })

          withModel({
            transform: model1
          }, () => {
            drawMesh()
          })
        })
      })
    })
  })
})
