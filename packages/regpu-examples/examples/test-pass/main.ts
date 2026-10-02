import { createREGPU } from '@filonik/regpu'

const regpu = await createREGPU('canvas')

const renderPass = regpu.render.pass<{ color: GPUColor }>({
  clear: (props) => props
})

function getColor(time: number): GPUColor {
  const colors = [
    [0.1, 0.18, 0.35, 1],
    [0.2, 0.45, 0.65, 1],
    [0.35, 0.25, 0.55, 1],
    [0.65, 0.25, 0.45, 1],
    [0.95, 0.6, 0.25, 1],
    [0.25, 0.55, 0.45, 1]
  ]

  const x = time / 2.5
  const i = Math.floor(x) % colors.length
  const t = x - Math.floor(x)

  // Smooth interpolation
  const s = t * t * (3 - 2 * t)

  const a = colors[i]
  const b = colors[(i + 1) % colors.length]

  return [
    a[0] + (b[0] - a[0]) * s,
    a[1] + (b[1] - a[1]) * s,
    a[2] + (b[2] - a[2]) * s,
    a[3] + (b[3] - a[3]) * s
  ]
}

regpu.frame(({ time }) => {
  const color = getColor(time)
  renderPass({ color }, () => {})
})
