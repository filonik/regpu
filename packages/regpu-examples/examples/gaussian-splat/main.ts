import { createREGPU, type Buffer } from '@filonik/regpu'
import { mat4 } from 'wgpu-matrix'

import projectWGSL from './project.wgsl?raw'
import renderWGSL from './render.wgsl?raw'
import sortWGSL from './sort.wgsl?raw'

import createCamera from './camera'

const NUM_SPLATS = 1 << 15
const WORKGROUP_SIZE = 256
type SceneProps = { uniforms: Record<string, ArrayLike<number>> }

function randGaussian() {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
function generateGalaxy(count: number) {
  const data = new Float32Array(count * 16)
  const core = [0.65, 0.78, 1]
  const rim = [1, 0.5, 0.22]
  const maxRadius = 3.4
  for (let i = 0; i < count; i++) {
    const r = maxRadius * Math.sqrt(Math.random())
    const angle = r * 1.7 + (i % 3) * ((2 * Math.PI) / 3) + randGaussian() * 0.22
    const t = Math.min(1, r / maxRadius)
    const brightness = 0.6 + Math.random() * 0.7
    const base = 0.014 + Math.random() * 0.02
    const half = Math.random() * Math.PI * 0.5
    data.set(
      [
        Math.cos(angle) * r,
        randGaussian() * (0.06 + (1 - t) * 0.28) * 0.35,
        Math.sin(angle) * r,
        1,
        base * (1 + Math.random() * 0.6),
        base * 0.3,
        base * (1 + Math.random() * 0.6),
        0,
        0,
        Math.sin(half),
        0,
        Math.cos(half),
        (core[0] + (rim[0] - core[0]) * t) * brightness,
        (core[1] + (rim[1] - core[1]) * t) * brightness,
        (core[2] + (rim[2] - core[2]) * t) * brightness,
        0.88 + Math.random() * 0.12
      ],
      i * 16
    )
  }
  return data
}

const canvas = document.querySelector('canvas')!
const regpu = await createREGPU(canvas)
const gaussians = regpu.buffer({ data: generateGalaxy(NUM_SPLATS) })
const splats = regpu.buffer({ size: NUM_SPLATS * 48 })
const sortEntries = regpu.buffer({ size: NUM_SPLATS * 8 })
const sortParams: Buffer[] = []
for (let k = 2; k <= NUM_SPLATS; k <<= 1) {
  for (let j = k >> 1; j > 0; j >>= 1) {
    sortParams.push(regpu.buffer({ data: new Uint32Array([k, j, NUM_SPLATS, 0]) }))
  }
}

const dispatchCount = Math.ceil(NUM_SPLATS / WORKGROUP_SIZE)
const computePass = regpu.compute.pass({})
const project = regpu.compute<SceneProps>({
  pipeline: { module: projectWGSL, entryPoint: 'project_main' },
  count: dispatchCount,
  uniforms: (props) => ({
    uniforms: props.uniforms
  }),
  buffers: { gaussians, splats, sortEntries }
})
const sort = regpu.compute<{ pass: number }>({
  pipeline: { module: sortWGSL, entryPoint: 'sort_main' },
  count: dispatchCount,
  buffers: (props) => ({ params: sortParams[props.pass], entries: sortEntries })
})
const renderPass = regpu.render.pass({
  clear: { color: [0.02, 0.02, 0.05, 1] },
  depthAttachment: null
})
const draw = regpu.render<SceneProps>({
  pipeline: {
    module: renderWGSL,
    depthStencil: null,
    blend: {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    }
  },
  count: 6,
  instances: NUM_SPLATS,
  uniforms: (props) => ({
    uniforms: props.uniforms
  }),
  buffers: { splats, sortEntries }
})

const camera = createCamera(canvas)

regpu.frame(({ time, delta }) => {
  camera.tick(delta)
  const fovY = (50 * Math.PI) / 180
  const focalY = canvas.height / (2 * Math.tan(fovY / 2))
  const uniforms = {
    viewMatrix: camera.view(),
    projMatrix: mat4.perspective(fovY, canvas.width / canvas.height, 0.1, 50),
    screenParams: [canvas.width, canvas.height, focalY, focalY],
    timeParams: [time, 0, 0, 0]
  }
  computePass(() => {
    project({ uniforms })
    sortParams.forEach((_params, pass) => sort({ pass }))
  })
  renderPass(() => draw({ uniforms }))
  document.querySelector('#stats')!.textContent =
    `${NUM_SPLATS.toLocaleString()} splats · ${(1 / Math.max(delta, 0.001)).toFixed(0)} fps`
})

setTimeout(() => {
  document.querySelector<HTMLElement>('#hint')!.style.opacity = '0'
}, 4000)
