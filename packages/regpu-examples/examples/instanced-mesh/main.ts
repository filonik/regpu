import { createREGPU } from '@filonik/regpu'
import { mat4 } from 'wgpu-matrix'

import instancedMeshCode from './instancedMesh.wgsl?raw'

import angleNormals from 'angle-normals'
import bunny from 'bunny'

const gridSize = 15
const instanceCount = gridSize * gridSize

const offsets: number[][] = []
const colors: number[][] = []
const angles = new Float32Array(instanceCount)

for (let index = 0; index < instanceCount; index++) {
  const x = Math.floor(index / gridSize)
  const z = index % gridSize
  const xRatio = x / (gridSize - 1)
  const zRatio = z / (gridSize - 1)

  offsets.push([(-1 + (2 * x) / gridSize) * 120, 0, (-1 + (2 * z) / gridSize) * 120])
  colors.push([
    xRatio * zRatio * 0.3 + 0.7 * zRatio,
    xRatio * xRatio * 0.5 + zRatio * zRatio * 0.4,
    xRatio * zRatio * xRatio + 0.35
  ])
  angles[index] = Math.random() * 2 * Math.PI
}

const regpu = await createREGPU('canvas')

const renderPass = regpu.render.pass({
  clear: { color: [0, 0, 0, 1] }
})
const drawBunnies = regpu.render<{ projection: Float32Array; view: Float32Array; time: number }>({
  pipeline: {
    module: instancedMeshCode,
    primitive: { topology: 'triangle-list' },
    attributes: {
      position: { type: 'vec3f' },
      normal: { type: 'vec3f' },
      offset: { type: 'vec3f', stepMode: 'instance' },
      color: { type: 'vec3f', stepMode: 'instance' },
      initialAngle: { type: 'f32', stepMode: 'instance' }
    }
  },
  attributes: {
    position: bunny.positions,
    normal: angleNormals(bunny.cells, bunny.positions),
    offset: offsets,
    color: colors,
    initialAngle: angles
  },
  indices: bunny.cells,
  instances: instanceCount,
  uniforms: (props) => ({
    camera: {
      projection: props.projection,
      view: props.view,
      time: [props.time]
    }
  })
})

const view = mat4.lookAt([0, 55, 165], [0, 0, 0], [0, 1, 0])

regpu.frame(({ canvas, time }) => {
  const projection = mat4.perspective(Math.PI / 2, canvas.width / canvas.height, 0.01, 1000)

  renderPass(() => {
    drawBunnies({ projection, view, time })
  })
})
