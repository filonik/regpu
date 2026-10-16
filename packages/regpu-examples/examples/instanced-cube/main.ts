import { createREGPU } from '@filonik/regpu'
import { mat4, type Mat4 } from 'wgpu-matrix'

import { cube } from '../textured-cube/cube'
import instancedCubeCode from './instancedCube.wgsl?raw'

const xCount = 4
const yCount = 4
const instanceCount = xCount * yCount
const matrixFloatCount = 16

const regpu = await createREGPU('canvas')

const renderPass = regpu.render.pass({
  clear: { color: [0.5, 0.5, 0.5, 1] }
})
const withPipeline = regpu.render<{ modelViewProjectionMatrix: Float32Array }>({
  pipeline: {
    module: instancedCubeCode,
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back'
    }
  },
  uniforms: (props) => ({
    uniforms: {
      modelViewProjectionMatrix: props.modelViewProjectionMatrix
    }
  })
})
const drawCubes = regpu.render({
  attributes: { position: cube.position },
  indices: cube.index,
  instances: instanceCount
})

const modelMatrices = new Array<Mat4>(instanceCount)
const mvpMatrices = new Float32Array(matrixFloatCount * instanceCount)
const viewMatrix = mat4.translation([0, 0, -6])
const temporaryMatrix = mat4.create()

let instance = 0
for (let x = 0; x < xCount; x++) {
  for (let y = 0; y < yCount; y++) {
    modelMatrices[instance++] = mat4.translation([
      2 * (x - xCount / 2 + 0.5),
      2 * (y - yCount / 2 + 0.5),
      0
    ])
  }
}

regpu.frame(({ canvas, time }) => {
  const projectionMatrix = mat4.perspective(
    (2 * Math.PI) / 5,
    canvas.width / canvas.height,
    0.5,
    50
  )

  let offset = 0
  let index = 0
  for (let x = 0; x < xCount; x++) {
    for (let y = 0; y < yCount; y++) {
      mat4.rotate(
        modelMatrices[index++],
        [Math.sin((x + 0.5) * time), Math.cos((y + 0.5) * time), 0],
        1,
        temporaryMatrix
      )
      mat4.multiply(viewMatrix, temporaryMatrix, temporaryMatrix)
      mat4.multiply(projectionMatrix, temporaryMatrix, temporaryMatrix)
      mvpMatrices.set(temporaryMatrix, offset)
      offset += matrixFloatCount
    }
  }

  renderPass(() => {
    withPipeline({ modelViewProjectionMatrix: mvpMatrices }, () => {
      drawCubes()
    })
  })
})
