// This example is based on: https://github.com/webgpu/webgpu-samples/tree/main/sample/deferredRendering

import { createREGPU, type UniformStruct } from '@filonik/regpu'
import { mat4 } from 'wgpu-matrix'

import createCamera from './camera'
import deferredCode from './deferred.wgsl?raw'
import gbufferCode from './gbuffer.wgsl?raw'
import lightsCode from './lights.wgsl?raw'

import { createSceneMesh } from './mesh'

// Parameters from the original sample are set directly instead of using dat.gui.
const maxLights = 1024
const lightCount = 128
const lightMin = [-50, -30, -50]
const lightMax = [50, 50, 50]

const canvas = document.querySelector('canvas')!
const regpu = await createREGPU(canvas)
const scene = createSceneMesh()
const targetUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
const normalTarget = regpu.texture({
  shape: [canvas.width, canvas.height],
  format: 'rgba16float',
  usage: targetUsage
})
const albedoTarget = regpu.texture({
  shape: [canvas.width, canvas.height],
  format: 'bgra8unorm',
  usage: targetUsage
})
const depthTarget = regpu.texture({
  shape: [canvas.width, canvas.height],
  format: 'depth24plus',
  usage: targetUsage
})

const gbufferPipeline = regpu.render.pipeline({
  label: 'G-buffer',
  module: gbufferCode,
  fragment: {
    targets: [{ format: 'rgba16float' }, { format: 'bgra8unorm' }]
  },
  primitive: { topology: 'triangle-list', cullMode: 'back' }
})
const deferredPipeline = regpu.render.pipeline({
  label: 'deferred lighting',
  module: deferredCode,
  depthStencil: null
})

let seed = 1
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000
const lightData = new Float32Array(maxLights * 8)
for (let index = 0; index < maxLights; index++) {
  const offset = index * 8
  for (let axis = 0; axis < 3; axis++)
    lightData[offset + axis] = random() * (lightMax[axis] - lightMin[axis]) + lightMin[axis]
  lightData[offset + 3] = 1
  lightData.set([random() * 2, random() * 2, random() * 2, 20], offset + 4)
}
const lights = regpu.buffer({ data: lightData })
const config = { count: new Uint32Array([lightCount]) }
const extent = { min: [...lightMin, 0], max: [...lightMax, 0] }

const updateLights = regpu.compute({
  pipeline: lightsCode,
  count: Math.ceil(lightCount / 64),
  buffers: { lights },
  uniforms: { config, extent }
})
const writeGbuffer = regpu.render<{ model: UniformStruct; camera: UniformStruct }>({
  pipeline: gbufferPipeline,
  attributes: { position: scene.positions, normal: scene.normals, uv: scene.uvs },
  indices: scene.indices,
  uniforms: (props) => ({
    model: props.model,
    camera: props.camera
  })
})
const lightScene = regpu.render<{ camera: UniformStruct }>({
  pipeline: deferredPipeline,
  count: 6,
  textures: { gBufferNormal: normalTarget, gBufferAlbedo: albedoTarget, gBufferDepth: depthTarget },
  buffers: { lights },
  uniforms: (props) => ({
    config,
    camera: props.camera
  })
})

const computePass = regpu.compute.pass({})
const gbufferPass = regpu.render.pass({
  colorAttachments: [normalTarget, albedoTarget],
  depthAttachment: depthTarget
})
const lightingPass = regpu.render.pass({ depthAttachment: null })

const modelMatrix = mat4.identity()
const normalMatrix = mat4.transpose(mat4.invert(modelMatrix))
const projection = mat4.perspective((2 * Math.PI) / 5, canvas.width / canvas.height, 1, 2000)
const orbitCamera = createCamera(canvas, {
  azimuth: Math.PI,
  elevation: Math.atan2(50, 100),
  distance: Math.hypot(50, 100),
  minDistance: 20,
  maxDistance: 250,
  autoRotateSpeed: (Math.PI * 2) / 5
})

regpu.frame(({ delta }) => {
  orbitCamera.tick(delta)
  const viewProjection = mat4.multiply(projection, orbitCamera.view())
  const camera = { viewProjection, inverseViewProjection: mat4.invert(viewProjection) }
  const model = { matrix: modelMatrix, normalMatrix }

  computePass(() => updateLights())
  gbufferPass(() => writeGbuffer({ model, camera }))
  lightingPass(() => lightScene({ camera }))
})
