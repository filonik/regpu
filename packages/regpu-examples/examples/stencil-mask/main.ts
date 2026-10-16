// This example is based on: https://github.com/webgpu/webgpu-samples/tree/main/sample/stencilMask
// See THIRD_PARTY.md for the upstream license.

import { createREGPU, type Texture } from '@filonik/regpu'
import { mat4, vec3 } from 'wgpu-matrix'
import {
  createCubeVertices,
  createCylinderVertices,
  createPlaneVertices,
  createSphereVertices,
  createTorusVertices,
  createTruncatedConeVertices,
  facet,
  reorientInPlace,
  type VertexData
} from './primitives'
import simpleLightingCode from './simple-lighting.wgsl?raw'

const regpu = await createREGPU('canvas')
const canvas = document.querySelector('canvas')!
const mouse = { x: 0, y: 0 }
canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = 1 - ((event.clientY - rect.top) / rect.height) * 2
})

// Both pipelines share the reflected vertex and uniform layouts.
const module = regpu.module(simpleLightingCode)
function makePipeline(stencilFront: GPUStencilFaceState) {
  return regpu.render.pipeline({
    module,
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: {
      format: 'depth24plus-stencil8',
      depthWriteEnabled: true,
      depthCompare: 'less',
      stencilFront
    }
  })
}
const stencilSetPipeline = makePipeline({ passOp: 'replace' })
const stencilMaskPipeline = makePipeline({ compare: 'equal', passOp: 'keep' })

type ObjectUniforms = { world: Float32Array; color: number[] }

// Split the upstream interleaved data into regpu's named attributes once.
function geometry({ vertices, indices }: VertexData) {
  const count = vertices.length / 8
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const texcoord = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    position.set(vertices.subarray(i * 8, i * 8 + 3), i * 3)
    normal.set(vertices.subarray(i * 8 + 3, i * 8 + 6), i * 3)
    texcoord.set(vertices.subarray(i * 8 + 6, i * 8 + 8), i * 2)
  }
  return regpu.render<ObjectUniforms>({
    attributes: { position, normal, texcoord },
    indices,
    uniforms: (props) => ({ uni: props })
  })
}

const plane = geometry(reorientInPlace(createPlaneVertices(), mat4.translation([0, 0.5, 0])))
const sphere = geometry(createSphereVertices())
const cube = geometry(createCubeVertices())
const torus = geometry(createTorusVertices({ thickness: 0.5 }))
const cone = geometry(createTruncatedConeVertices())
const cylinder = geometry(createCylinderVertices())
const gem = geometry(facet(createSphereVertices({ subdivisionsAxis: 6, subdivisionsHeight: 5 })))
const dice = geometry(
  facet(createTorusVertices({ thickness: 0.5, radialSubdivisions: 8, bodySubdivisions: 8 }))
)

function random(min: number, max: number) {
  return min + Math.random() * (max - min)
}

const colorContext = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!
function color(hue: number) {
  colorContext.fillStyle = `hsl(${(hue * 360) | 0}, ${random(70, 100)}%, ${random(50, 80)}%)`
  colorContext.fillRect(0, 0, 1, 1)
  return Array.from(colorContext.getImageData(0, 0, 1, 1).data, (value) => value / 255)
}

function makeScene(count: number, hue: number, draw: ReturnType<typeof geometry>) {
  return {
    draw,
    viewProjection: mat4.create(),
    objects: Array.from({ length: count }, () => ({
      world: mat4.create(),
      color: color(hue + random(0, 0.2))
    }))
  }
}
type Scene = ReturnType<typeof makeScene>

const masks = Array.from({ length: 6 }, (_, i) => makeScene(1, i / 6 + 0.5, plane))
const scenes = [sphere, cube, torus, cone, cylinder, gem, dice].map((draw, i) =>
  makeScene(100, i / 7, draw)
)
const rotations = [
  [0, 0],
  [1, 0],
  [0, 0.5],
  [0, -0.5],
  [-0.5, 0],
  [0.5, 0]
]
const lightDirection = vec3.normalize([1, 8, 10])

const withScene = regpu.render<{
  scene: Scene
  stencilReference: number
  mask: boolean
}>({
  pipeline: (props) => (props.mask ? stencilSetPipeline : stencilMaskPipeline),
  stencilReference: (props) => props.stencilReference,
  uniforms: (props) => ({
    sharedUni: { viewProjection: props.scene.viewProjection, lightDirection }
  })
})

// A stencil-capable attachment is explicit: the automatic depth texture is depth24plus.
let depthStencil: Texture | undefined
let depthWidth = 0
let depthHeight = 0
type PassProps = { colorView: GPUTextureView; depthView: GPUTextureView; first: boolean }
const renderPass = regpu.render.pass<PassProps>({
  clear: { color: [0.2, 0.2, 0.2, 1], depth: 1, stencil: 0 },
  colorAttachments: ({ colorView, first }) => [
    { view: colorView, loadOp: first ? 'clear' : 'load', storeOp: 'store' }
  ],
  depthAttachment: ({ depthView, first }) => ({
    view: depthView,
    // Every scene gets fresh depth while preserving the mask and previous color.
    depthLoadOp: 'clear',
    depthStoreOp: 'store',
    stencilLoadOp: first ? 'clear' : 'load',
    stencilStoreOp: 'store'
  })
})

function updateMask(scene: Scene, index: number, time: number, projection: Float32Array) {
  const world = scene.objects[0].world
  const cameraDistance = 45 // Matches the mask camera's Z position
  mat4.multiply(
    projection,
    mat4.lookAt([0, 0, cameraDistance], [0, 0, 0], [0, 1, 0]),
    scene.viewProjection
  )
  mat4.translation(
    [(mouse.x * cameraDistance) / projection[0], (mouse.y * cameraDistance) / projection[5], 0],
    world
  )
  mat4.rotateX(world, time * 0.25, world)
  mat4.rotateY(world, time * 0.15, world)
  mat4.rotateX(world, rotations[index][0] * Math.PI, world)
  mat4.rotateZ(world, rotations[index][1] * Math.PI, world)
  mat4.scale(world, [10, 10, 10], world)
}

function updateScene(scene: Scene, index: number, time: number, projection: Float32Array) {
  const orbit = index % 2 === 1
  const eye = orbit ? [Math.cos(time * 0.1) * 35, 4, Math.sin(time * 0.1) * 35] : [0, 0, 35]
  mat4.multiply(projection, mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]), scene.viewProjection)
  scene.objects.forEach(({ world }, i) => {
    mat4.translation([0, 0, Math.sin(i * 3.721 + time * 0.1) * 10], world)
    mat4.rotateX(world, i * 4.567, world)
    mat4.rotateY(world, i * 2.967, world)
    mat4.translate(world, [0, 0, Math.sin(i * 9.721 + time * 0.1) * 10], world)
    mat4.rotateX(world, time * (orbit ? 1.53 : 0.53) + i, world)
  })
}

regpu.frame(({ canvas, context, time }) => {
  if (!depthStencil || depthWidth !== canvas.width || depthHeight !== canvas.height) {
    depthStencil?.destroy()
    depthWidth = canvas.width
    depthHeight = canvas.height
    depthStencil = regpu.texture({
      shape: [depthWidth, depthHeight],
      format: 'depth24plus-stencil8',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    })
  }
  const colorView = context.getCurrentTexture().createView()
  const depthView = depthStencil.view()
  const projection = mat4.perspective(Math.PI / 6, canvas.width / canvas.height, 0.5, 100)

  // Six passes write distinct references for the cube faces. Seven more draw
  // independent scenes only where their reference matches, including background 0.
  masks.forEach((scene, index) => {
    updateMask(scene, index, time, projection)
    renderPass({ colorView, depthView, first: index === 0 }, () => {
      withScene({ scene, stencilReference: index + 1, mask: true }, () => {
        scene.draw(scene.objects[0])
      })
    })
  })
  scenes.forEach((scene, index) => {
    updateScene(scene, index, time, projection)
    renderPass({ colorView, depthView, first: false }, () => {
      withScene({ scene, stencilReference: index, mask: false }, () => {
        scene.objects.forEach((object) => scene.draw(object))
      })
    })
  })
})
