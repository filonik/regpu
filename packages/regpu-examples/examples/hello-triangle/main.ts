import { createREGPU } from '@filonik/regpu'

import helloTriangleCode from './helloTriangle.wgsl?raw'

const regpu = await createREGPU('canvas')

const renderPass = regpu.render.pass({})
const withSolidPipeline = regpu.render({ pipeline: helloTriangleCode })
const drawTriangle = regpu.render({ count: 3 })

regpu.frame(() => {
  renderPass(() => {
    withSolidPipeline(() => {
      drawTriangle()
    })
  })
})
