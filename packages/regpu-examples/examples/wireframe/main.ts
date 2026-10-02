// This example is based on: https://github.com/webgpu/webgpu-samples/tree/main/sample/wireframe

import { createREGPU, type UniformStruct } from '@filonik/regpu'
import { mat4 } from 'wgpu-matrix'

import { modelData } from './models'
import wireframeCode from './wireframe.wgsl?raw'

// Parameters from the original sample are set directly instead of using dat.gui.
const objectCount = 200
const depthBias = 1
const depthBiasSlopeScale = 0.5

const regpu = await createREGPU('canvas')
const renderPass = regpu.render.pass({ clear: { color: [0.3, 0.3, 0.3, 1] } })
const shaderModule = regpu.module(wireframeCode)

const litPipeline = regpu.render.pipeline({
  label: 'lit pipeline',
  module: shaderModule,
  vertex: {
    entryPoint: 'vsLit'
  },
  fragment: {
    entryPoint: 'fsLit'
  },
  attributes: { position: { location: 0, type: 'vec3f' }, normal: { location: 1, type: 'vec3f' } },
  primitive: { topology: 'triangle-list', cullMode: 'back' },
  depthStencil: {
    format: 'depth24plus',
    depthWriteEnabled: true,
    depthCompare: 'less',
    depthBias,
    depthBiasSlopeScale
  }
})

const wirePipeline = regpu.render.pipeline({
  label: 'wireframe pipeline',
  module: shaderModule,
  vertex: {
    entryPoint: 'vsWire'
  },
  fragment: {
    entryPoint: 'fsWire'
  },
  primitive: { topology: 'line-list' },
  depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' }
})

const models = modelData.map((model) => ({
  ...model,
  positionsBuffer: regpu.buffer({ data: model.positions }),
  indicesBuffer: regpu.buffer({ data: model.indices })
}))

const drawLit = models.map((model) =>
  regpu.render<{ uni: UniformStruct }>({
    pipeline: litPipeline,
    attributes: { position: model.positions, normal: model.normals },
    indices: model.indices,
    uniforms: (props) => ({ uni: props.uni })
  })
)
const drawWire = models.map((model) =>
  regpu.render<{ uni: UniformStruct }>({
    pipeline: wirePipeline,
    count: model.indices.length * 2,
    buffers: { positions: model.positionsBuffer, indices: model.indicesBuffer },
    uniforms: (props) => ({
      uni: props.uni,
      line: { stride: new Uint32Array([3]), thickness: [2], alphaThreshold: [0.5] }
    })
  })
)

const objects = Array.from({ length: objectCount }, (_, index) => ({
  model: index % models.length,
  color: [
    0.2 + ((index * 47) % 80) / 100,
    0.2 + ((index * 67) % 80) / 100,
    0.2 + ((index * 29) % 80) / 100,
    1
  ]
}))
const viewProjection = mat4.create()
const world = mat4.create()
const worldViewProjection = mat4.create()

regpu.frame(({ canvas, time }) => {
  const projection = mat4.perspective((60 * Math.PI) / 180, canvas.width / canvas.height, 0.1, 1000)
  const view = mat4.lookAt([-300, 0, 300], [0, 0, 0], [0, 1, 0])
  mat4.multiply(projection, view, viewProjection)

  renderPass(() => {
    for (let index = 0; index < objects.length; index++) {
      mat4.identity(world)
      mat4.translate(world, [0, 0, Math.sin(index * 3.721 + time * 0.1) * 200], world)
      mat4.rotateX(world, index * 4.567, world)
      mat4.rotateY(world, index * 2.967, world)
      mat4.translate(world, [0, 0, Math.sin(index * 9.721 + time * 0.1) * 200], world)
      mat4.rotateX(world, time * 0.53 + index, world)
      mat4.multiply(viewProjection, world, worldViewProjection)

      const object = objects[index]
      const uni = {
        worldViewProjectionMatrix: worldViewProjection,
        worldMatrix: world,
        color: object.color
      }
      drawLit[object.model]({ uni })
      drawWire[object.model]({ uni })
    }
  })
})
