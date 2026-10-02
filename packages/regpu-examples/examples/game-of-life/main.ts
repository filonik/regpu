// This example is based on: https://github.com/webgpu/webgpu-samples/tree/main/sample/gameOfLife

import { createREGPU } from '@filonik/regpu'

import computeWGSL from './compute.wgsl?raw'
import vertWGSL from './vert.wgsl?raw'
import fragWGSL from './frag.wgsl?raw'

const GameOptions = { width: 128, height: 128, timestep: 4, workgroupSize: 8 }
const length = GameOptions.width * GameOptions.height
const initialCells = Uint32Array.from({ length }, () => (Math.random() < 0.25 ? 1 : 0))

const regpu = await createREGPU('canvas')
const size = regpu.buffer({ data: new Uint32Array([GameOptions.width, GameOptions.height]) })
const cells = [
  regpu.buffer({ data: initialCells }),
  regpu.buffer({ size: initialCells.byteLength })
]
const computePass = regpu.compute.pass({})
const updateCells = regpu.compute<{ loopTimes: number }>({
  pipeline: { module: computeWGSL, entryPoint: 'main' },
  count: [
    GameOptions.width / GameOptions.workgroupSize,
    GameOptions.height / GameOptions.workgroupSize
  ],
  buffers: (props) => ({
    size,
    current: cells[props.loopTimes],
    next: cells[1 - props.loopTimes]
  })
})
const renderPass = regpu.render.pass({})
const drawCells = regpu.render<{ loopTimes: number }>({
  pipeline: { module: `${vertWGSL}\n${fragWGSL}`, primitive: { topology: 'triangle-strip' } },
  count: 4,
  instances: length,
  buffers: (props) => ({ size, cells: cells[props.loopTimes] })
})

let wholeTime = 0
let loopTimes = 0
regpu.frame(() => {
  if (++wholeTime >= GameOptions.timestep) {
    wholeTime -= GameOptions.timestep
    computePass(() => updateCells({ loopTimes }))
    loopTimes = 1 - loopTimes
  }
  renderPass(() => drawCells({ loopTimes }))
})
