import type * as REGPU from './types'

import {
  getUniformBufferSize,
  type UniformLayoutEntry,
  type UniformBindingLayout,
  type BindGroupLayout
} from './layout'

function isUniformData(value: REGPU.UniformValue): value is REGPU.UniformData {
  return typeof value.length === 'number'
}

export function toUniformBufferData(
  layout: UniformLayoutEntry[],
  uniforms: REGPU.Uniforms
): ArrayBuffer | undefined {
  if (!layout.length) return undefined

  const buffer = new ArrayBuffer(getUniformBufferSize(layout))
  const bytes = new Uint8Array(buffer)

  for (const entry of layout) {
    const value = uniforms[entry.name]

    if (!value || !isUniformData(value)) {
      throw new Error(`Missing uniform: ${entry.name}`)
    }

    const source = entry.type.includes('u32')
      ? new Uint32Array(value)
      : entry.type.includes('i32')
        ? new Int32Array(value)
        : new Float32Array(value)
    if (source.byteLength > entry.size) {
      throw new Error(`Uniform data exceeds layout size: ${entry.name}`)
    }
    bytes.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength), entry.offset)
  }

  return buffer
}

export function createBindings(device: GPUDevice, trackBuffer: (buffer: GPUBuffer) => void) {
  function createUniformBindingResource(
    entry: UniformBindingLayout,
    uniforms: REGPU.Uniforms | undefined
  ): GPUBindingResource {
    const value =
      entry.source === 'root'
        ? uniforms
        : (uniforms?.[entry.name] as REGPU.UniformStruct | undefined)

    if (!value || ArrayBuffer.isView(value) || Array.isArray(value)) {
      throw new Error(`Invalid uniform binding: ${entry.name}`)
    }

    const data = toUniformBufferData(entry.layout, value)

    if (!data) {
      throw new Error(`Missing uniform binding: ${entry.name}`)
    }

    const buffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })

    trackBuffer(buffer)

    device.queue.writeBuffer(buffer, 0, data)

    return { buffer }
  }

  function createBindingGroups(
    pipeline: GPUComputePipeline | GPURenderPipeline,
    layout: BindGroupLayout[] | undefined,
    state: Pick<REGPU.RenderPipelineProps, 'uniforms' | 'textures' | 'samplers' | 'buffers'>
  ): GPUBindGroup[] {
    if (!layout?.length) return []

    return layout.map((groupLayout) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(groupLayout.group),
        entries: groupLayout.entries.map((entry) => {
          switch (entry.kind) {
            case 'uniform':
              return {
                binding: entry.binding,
                resource: createUniformBindingResource(entry, state.uniforms)
              }
            case 'texture': {
              const texture = state.textures?.[entry.name]

              if (!texture) {
                throw new Error(`Missing texture binding: ${entry.name}`)
              }

              return {
                binding: entry.binding,
                resource: texture.view(entry.view)
              }
            }
            case 'sampler': {
              const sampler = state.samplers?.[entry.name]

              if (!sampler) {
                throw new Error(`Missing sampler binding: ${entry.name}`)
              }

              return {
                binding: entry.binding,
                resource: sampler._gpu
              }
            }
            case 'buffer': {
              const buffer = state.buffers?.[entry.name]
              if (!buffer) throw new Error(`Missing buffer binding: ${entry.name}`)
              return { binding: entry.binding, resource: { buffer: buffer._gpu } }
            }
          }
        })
      })
    )
  }

  return { createBindingGroups }
}
