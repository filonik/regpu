// This example is based on: https://webgpufundamentals.org/webgpu/webgpu-multiple-canvases-x200-optimized.html

import { createREGPU, type Context } from '@filonik/regpu'
import { mat4 } from 'wgpu-matrix'
import shader from './preview.wgsl?raw'
import './style.css'

const gallery = document.querySelector<HTMLElement>('#gallery')!
const count = document.querySelector<HTMLElement>('#visible-count')!
const pause = document.querySelector<HTMLButtonElement>('#pause')!
const visibleOnly = document.querySelector<HTMLInputElement>('#visible-only')!
const size = document.querySelector<HTMLInputElement>('#preview-size')!
const visible = new Set<HTMLCanvasElement>()
const palette = [
  [0.16, 0.49, 0.43],
  [0.78, 0.35, 0.2],
  [0.31, 0.38, 0.69],
  [0.68, 0.45, 0.19],
  [0.62, 0.31, 0.47],
  [0.22, 0.48, 0.63]
]
const ratios = ['1 / 1', '4 / 3', '3 / 4', '5 / 4']
const previews = new Map<
  HTMLCanvasElement,
  {
    color: number[]
    clear: { r: number; g: number; b: number; a: number }
    phase: number
    speed: number
  }
>()

for (let index = 0; index < 200; index++) {
  const color = palette[index % palette.length]
  const clear = color.map((channel) => 0.9 + channel * 0.08)
  const card = document.createElement('figure')
  card.className = 'preview'
  card.style.setProperty('--aspect', ratios[index % ratios.length])
  card.style.setProperty(
    '--background',
    `rgb(${clear.map((channel) => Math.round(channel * 255)).join(' ')})`
  )
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-label', `Animated preview ${index + 1}`)
  const caption = document.createElement('figcaption')
  caption.textContent = `Study ${String(index + 1).padStart(3, '0')}`
  const ratio = document.createElement('span')
  ratio.textContent = ratios[index % ratios.length].replace(' / ', ':')
  caption.append(ratio)
  card.append(canvas, caption)
  gallery.append(card)
  previews.set(canvas, {
    color: [...color, 1],
    clear: { r: clear[0], g: clear[1], b: clear[2], a: 1 },
    phase: index * 0.73,
    speed: 0.25 + (index % 9) * 0.06
  })
}

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const canvas = entry.target as HTMLCanvasElement
    if (entry.isIntersecting) visible.add(canvas)
    else visible.delete(canvas)
  }
  count.textContent = String(visible.size)
})
for (const canvas of previews.keys()) observer.observe(canvas)
size.addEventListener('input', () => {
  document.documentElement.style.setProperty('--preview-size', `${size.value}px`)
})

async function main() {
  // A selector, array, NodeList, or single canvas all use the same initialization path.
  const regpu = await createREGPU({ canvas: '#gallery canvas' })
  const pass = regpu.render.pass<{ clear: GPUColor }>({
    clear: ({ clear }) => ({ color: clear }),
    depthAttachment: null
  })
  // One pipeline shared across all 200 canvas contexts; uniforms vary per draw.
  const triangle = regpu.render<{ matrix: Float32Array; color: number[] }>({
    pipeline: { module: shader, depthStencil: null },
    uniforms: ({ matrix, color }) => ({ preview: { matrix, color } }),
    count: 3
  })
  const matrix = mat4.create()
  let animationTime = 0
  function draw({ canvas }: Context) {
    // Skip all matrix, attachment, and GPU work for offscreen canvases.
    if (visibleOnly.checked && !visible.has(canvas)) return
    const preview = previews.get(canvas)!
    const aspect = canvas.width / canvas.height
    mat4.ortho(-aspect, aspect, -1, 1, -1, 1, matrix)
    mat4.rotateZ(matrix, animationTime * preview.speed + preview.phase, matrix)
    pass({ clear: preview.clear }, () => triangle({ matrix, color: preview.color }))
  }
  function render({ delta }: Context) {
    animationTime += delta
    regpu.perCanvas(draw)
  }
  let stop: (() => void) | undefined = regpu.frame(render)
  pause.disabled = false
  pause.addEventListener('click', () => {
    if (stop) {
      stop()
      stop = undefined
    } else {
      stop = regpu.frame(render)
    }
    pause.textContent = stop ? 'Pause animation' : 'Resume animation'
  })
  addEventListener(
    'pagehide',
    () => {
      stop?.()
      observer.disconnect()
    },
    { once: true }
  )
}

void main().catch((error: unknown) => {
  console.error('Renderer initialization failed', error)
  observer.disconnect()
})
