// This example is based on: https://github.com/webgpu/webgpu-samples/tree/main/sample/computeBoids

import { createREGPU } from '@filonik/regpu'

import spriteWGSL from './sprite.wgsl?raw'
import updateSpritesWGSL from './updateSprites.wgsl?raw'

const simParams = {
  deltaT: [0.04],
  rule1Distance: [0.1],
  rule2Distance: [0.025],
  rule3Distance: [0.025],
  rule1Scale: [0.02],
  rule2Scale: [0.05],
  rule3Scale: [0.005]
}
const numParticles = 1500
const initialParticleData = new Float32Array(numParticles * 4)
for (let i = 0; i < numParticles; ++i) {
  initialParticleData[4 * i + 0] = 2 * (Math.random() - 0.5)
  initialParticleData[4 * i + 1] = 2 * (Math.random() - 0.5)
  initialParticleData[4 * i + 2] = 2 * (Math.random() - 0.5) * 0.1
  initialParticleData[4 * i + 3] = 2 * (Math.random() - 0.5) * 0.1
}

const regpu = await createREGPU('canvas')
const particleBuffers = [
  regpu.buffer({ data: initialParticleData }),
  regpu.buffer({ data: initialParticleData })
]
const computePass = regpu.compute.pass({})
const updateSprites = regpu.compute<{ t: number }>({
  pipeline: { module: updateSpritesWGSL, entryPoint: 'main' },
  count: Math.ceil(numParticles / 64),
  uniforms: { params: simParams },
  buffers: (props) => ({
    particlesA: particleBuffers[props.t % 2],
    particlesB: particleBuffers[(props.t + 1) % 2]
  })
})
const renderPass = regpu.render.pass({ clear: { color: [0, 0, 0, 1] } })
const drawSprites = regpu.render<{ t: number }>({
  pipeline: { module: spriteWGSL },
  count: 3,
  instances: numParticles,
  buffers: (props) => ({ particles: particleBuffers[props.t % 2] })
})

let t = 0
regpu.frame(() => {
  computePass(() => updateSprites({ t }))
  ++t
  renderPass(() => drawSprites({ t }))
})
