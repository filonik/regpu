import angleNormals from 'angle-normals'
import bunny from 'bunny'

export type ModelData = {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

function makeModel(positions: number[][], cells: number[][]): ModelData {
  return {
    positions: new Float32Array(positions.flat()),
    normals: new Float32Array(angleNormals(cells, positions).flat()),
    indices: new Uint32Array(cells.flat())
  }
}

function sphere(radius: number, width: number, height: number, roughness = 0): ModelData {
  const positions: number[][] = []
  const cells: number[][] = []
  for (let y = 0; y <= height; y++) {
    const v = y / height
    const phi = v * Math.PI
    for (let x = 0; x <= width; x++) {
      const theta = (x / width) * Math.PI * 2
      const noise = 1 + roughness * Math.sin(x * 12.9898 + y * 78.233)
      positions.push([
        Math.sin(phi) * Math.cos(theta) * radius * noise,
        Math.cos(phi) * radius * noise,
        Math.sin(phi) * Math.sin(theta) * radius * noise
      ])
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = y * (width + 1) + x
      const b = a + width + 1
      cells.push([a, a + 1, b], [a + 1, b + 1, b])
    }
  }
  return makeModel(positions, cells)
}

const bunnyPositions = bunny.positions.map(([x, y, z]) => [x * 4, y * 4 - 16, z * 4])

export const modelData = [
  makeModel(bunnyPositions, bunny.cells),
  sphere(20, 24, 12),
  sphere(20, 5, 3),
  sphere(20, 18, 10, 0.12)
]
