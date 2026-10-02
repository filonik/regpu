import angleNormals from 'angle-normals'
import bunny from 'bunny'

export function createSceneMesh() {
  const positions = bunny.positions.map(([x, y, z]) => [x * 5, y * 5 - 25, z * 5])
  const normals = angleNormals(bunny.cells, bunny.positions)
  const uvs = bunny.positions.map(([x, y]) => [x / 10 + 0.5, y / 10])
  const indices = bunny.cells.flat()

  const base = positions.length
  positions.push([-100, -25, -100], [-100, -25, 100], [100, -25, -100], [100, -25, 100])
  normals.push([0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0])
  uvs.push([0, 0], [0, 1], [1, 0], [1, 1])
  indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)

  return { positions, normals, uvs, indices }
}
