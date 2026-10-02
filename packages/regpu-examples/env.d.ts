/// <reference types="vite/client" />

declare module 'bunny' {
  const bunny: {
    positions: number[][]
    cells: number[][]
  }
  export default bunny
}

declare module 'angle-normals' {
  export default function angleNormals(cells: number[][], positions: number[][]): number[][]
}

declare module 'conway-hart' {
  type Mesh = { positions: number[][]; cells: number[][] }
  export default function createConwayHart(notation: string): Mesh
}
