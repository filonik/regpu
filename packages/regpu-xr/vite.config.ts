import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'regpuXR',
      fileName: 'regpu-xr'
    },
    rollupOptions: {
      external: ['@filonik/regpu'],
      output: {
        globals: { '@filonik/regpu': 'regpu' }
      }
    }
  }
})
