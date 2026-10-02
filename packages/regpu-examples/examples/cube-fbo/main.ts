// This example is based on: https://github.com/mikolalysenko/regl/blob/gh-pages/example/cube-fbo.js

import { createREGPU, type Uniforms, type UniformStruct } from '@filonik/regpu'
import { mat4, vec3 } from 'wgpu-matrix'

import createCamera from './camera'
import groundCode from './ground.wgsl?raw'
import reflectCode from './reflect.wgsl?raw'

import angleNormals from 'angle-normals'
import bunny from 'bunny'
import createConwayHart from 'conway-hart'

const teapot = createConwayHart('I')
const teapotPositions = teapot.positions.map(([x, y, z]) => [2.2 * x, 2.2 * y, 2.2 * z])

const cubeMapSize = 512
const colorFormat: GPUTextureFormat = 'rgba8unorm'
const groundHeight = -5
const groundTiles = 20
const bunnyTint = [1, 0.8, 0.9]
const teapotTint = [0.9, 1, 0.8]
const cubeSides = [
  { target: [1, 0, 0], up: [0, -1, 0] },
  { target: [-1, 0, 0], up: [0, -1, 0] },
  { target: [0, 1, 0], up: [0, 0, 1] },
  { target: [0, -1, 0], up: [0, 0, -1] },
  { target: [0, 0, 1], up: [0, -1, 0] },
  { target: [0, 0, -1], up: [0, -1, 0] }
]

const canvas = document.querySelector('canvas')!
const regpu = await createREGPU({ canvas, format: colorFormat })
const renderTargetUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
const makeCubeTarget = () => {
  const texture = regpu.texture({
    shape: [cubeMapSize, cubeMapSize, 6],
    format: colorFormat,
    usage: renderTargetUsage,
    view: { dimension: 'cube' }
  })
  const faceViews = Array.from({ length: 6 }, (_, baseArrayLayer) =>
    texture.view({
      dimension: '2d',
      baseArrayLayer,
      arrayLayerCount: 1
    })
  )
  return { texture, faceViews }
}
const bunnyCube = makeCubeTarget()
const teapotCube = makeCubeTarget()
const cubeDepth = regpu.texture({
  shape: [cubeMapSize, cubeMapSize],
  format: 'depth24plus',
  usage: GPUTextureUsage.RENDER_ATTACHMENT
})
const sampler = regpu.sampler({ minFilter: 'linear', magFilter: 'linear' })

const cubePass = regpu.render.pass<{ view: GPUTextureView; clear: GPUColor }>({
  colorAttachments: (props) => [
    {
      view: props.view,
      clear: props.clear
    }
  ],
  depthAttachment: cubeDepth
})
const renderPass = regpu.render.pass({ clear: { color: [0, 0, 0, 1], depth: 1 } })

const drawGround = regpu.render<{ camera: UniformStruct }>({
  pipeline: { module: groundCode, primitive: { topology: 'triangle-list', cullMode: 'none' } },
  attributes: {
    position: [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ]
  },
  uniforms: (props) => ({
    camera: props.camera,
    ground: { height: [groundHeight], tiles: [groundTiles] }
  }),
  count: 6
})

const reflectivePipeline = regpu.render.pipeline({
  module: reflectCode,
  primitive: { topology: 'triangle-list', cullMode: 'back' }
})

const drawBunny = regpu.render<{ uniforms: Uniforms }>({
  pipeline: reflectivePipeline,
  attributes: { position: bunny.positions, normal: angleNormals(bunny.cells, bunny.positions) },
  indices: bunny.cells,
  textures: { environment: bunnyCube.texture },
  samplers: { environmentSampler: sampler },
  uniforms: (props) => props.uniforms
})

const drawTeapot = regpu.render<{ uniforms: Uniforms }>({
  pipeline: reflectivePipeline,
  attributes: { position: teapotPositions, normal: angleNormals(teapot.cells, teapot.positions) },
  indices: teapot.cells,
  textures: { environment: teapotCube.texture },
  samplers: { environmentSampler: sampler },
  uniforms: (props) => props.uniforms
})

const projection = mat4.create()
const view = mat4.create()
const model = mat4.create()

const orbitCamera = createCamera(canvas, {
  azimuth: Math.PI / 2,
  elevation: 0,
  distance: 20,
  maxDistance: 60,
  autoRotate: false
})

function objectUniforms(position: number[], tint: number[]) {
  mat4.translation(position, model)
  return { model, tint }
}

function renderCube(
  faceViews: GPUTextureView[],
  center: number[],
  clear: GPUColor,
  drawScene: (camera: UniformStruct) => void
) {
  cubeSides.forEach((side, face) => {
    const targetPoint = vec3.add(center, side.target)
    mat4.perspective(Math.PI / 2, 1, 0.25, 1000, projection)
    mat4.lookAt(center, targetPoint, side.up, view)
    cubePass({ view: faceViews[face], clear }, () => drawScene({ projection, view, eye: center }))
  })
}

regpu.frame(({ time, delta }) => {
  orbitCamera.tick(delta)
  const bunnyPosition = [15 * Math.cos(time), -2.5, 15 * Math.sin(time)]
  const teapotPosition = [0, 3, 0]

  renderCube(teapotCube.faceViews, teapotPosition, [0.2, 0.2, 0.2, 1], (camera) => {
    drawGround({ camera })
    drawBunny({ uniforms: { camera, object: objectUniforms(bunnyPosition, bunnyTint) } })
  })
  renderCube(bunnyCube.faceViews, bunnyPosition, [0, 0, 0, 1], (camera) => {
    drawGround({ camera })
    drawTeapot({ uniforms: { camera, object: objectUniforms(teapotPosition, teapotTint) } })
  })

  const sceneCamera = {
    projection: mat4.perspective(Math.PI / 4, canvas.width / canvas.height, 0.25, 1000),
    view: orbitCamera.view(),
    eye: orbitCamera.eye()
  }
  renderPass(() => {
    drawGround({ camera: sceneCamera })
    drawTeapot({
      uniforms: { camera: sceneCamera, object: objectUniforms(teapotPosition, teapotTint) }
    })
    drawBunny({
      uniforms: { camera: sceneCamera, object: objectUniforms(bunnyPosition, bunnyTint) }
    })
  })
})
