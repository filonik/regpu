import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        helloTriangle: resolve(import.meta.dirname, 'examples/hello-triangle/index.html'),
        helloCube: resolve(import.meta.dirname, 'examples/hello-cube/index.html'),
        twoCubes: resolve(import.meta.dirname, 'examples/two-cubes/index.html'),
        instancedCube: resolve(import.meta.dirname, 'examples/instanced-cube/index.html'),
        instancedMesh: resolve(import.meta.dirname, 'examples/instanced-mesh/index.html'),
        texturedCube: resolve(import.meta.dirname, 'examples/textured-cube/index.html'),
        envmap: resolve(import.meta.dirname, 'examples/envmap/index.html'),
        cubeFbo: resolve(import.meta.dirname, 'examples/cube-fbo/index.html'),
        computeBoids: resolve(import.meta.dirname, 'examples/compute-boids/index.html'),
        marchingCubes: resolve(import.meta.dirname, 'examples/marching-cubes/index.html'),
        metaball: resolve(import.meta.dirname, 'examples/metaball/index.html'),
        gameOfLife: resolve(import.meta.dirname, 'examples/game-of-life/index.html'),
        testPass: resolve(import.meta.dirname, 'examples/test-pass/index.html'),
        gaussianSplat: resolve(import.meta.dirname, 'examples/gaussian-splat/index.html'),
        wireframe: resolve(import.meta.dirname, 'examples/wireframe/index.html'),
        deferredRendering: resolve(import.meta.dirname, 'examples/deferred-rendering/index.html')
      }
    }
  },
  resolve: {
    alias: {
      '@filonik/regpu': resolve(__dirname, '../regpu/src/index.ts')
    }
  }
})
