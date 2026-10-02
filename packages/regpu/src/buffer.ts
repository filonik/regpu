import type * as REGPU from './types'

export type VertexBufferMap = Record<string, GPUBuffer>
export type IndexBufferResource = {
  gpu: GPUBuffer
  format: GPUIndexFormat
  count: number
}

function isBuffer(value: unknown): value is REGPU.Buffer {
  return typeof value === 'object' && value !== null && '_gpu' in value
}

function flatten(data: REGPU.VertexData): number[] {
  const first = data[0]
  if (Array.isArray(first) || ArrayBuffer.isView(first)) {
    return Array.from(data as ArrayLike<ArrayLike<number>>).flatMap((value) => Array.from(value))
  }
  return Array.from(data as ArrayLike<number>)
}

export function createREGPUBuffers(context: REGPU.Context) {
  const { device } = context

  function createBuffer(arg: REGPU.BufferArg): REGPU.Buffer {
    const data = Array.isArray(arg.data) ? new Float32Array(flatten(arg.data)) : arg.data
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data && new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    const size = arg.size ?? bytes?.byteLength
    if (size === undefined) throw new Error('Buffer requires data or size')
    if (size < 0 || !Number.isSafeInteger(size)) throw new Error('Invalid buffer size')
    if (bytes && bytes.byteLength > size) throw new Error('Buffer data exceeds size')

    // WebGPU writes operate on four-byte units. Pad subviews without uploading
    // unrelated bytes from their backing allocation.
    const alignedSize = Math.ceil(size / 4) * 4
    const gpu = device.createBuffer({
      label: arg.label,
      size: alignedSize,
      usage: arg.usage ?? GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    })
    if (bytes?.byteLength) {
      const upload = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4)
      upload.set(bytes)
      device.queue.writeBuffer(gpu, 0, upload)
    }
    return { _gpu: gpu, destroy: () => gpu.destroy() }
  }

  function buffer(arg: REGPU.Buffer | REGPU.BufferArg): REGPU.Buffer {
    return isBuffer(arg) ? arg : createBuffer(arg)
  }

  const vertexCache = new WeakMap<Record<string, REGPU.VertexData>, VertexBufferMap>()
  function vertexBuffers(attributes: Record<string, REGPU.VertexData>): VertexBufferMap {
    let result = vertexCache.get(attributes)
    if (!result) {
      result = Object.fromEntries(
        Object.entries(attributes).map(([name, data]) => [
          name,
          buffer({
            data: new Float32Array(flatten(data)),
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
          })._gpu
        ])
      )
      vertexCache.set(attributes, result)
    }
    return result
  }

  const indexCache = new WeakMap<REGPU.VertexData, IndexBufferResource>()
  function indexBuffer(indices: REGPU.VertexData): IndexBufferResource {
    let result = indexCache.get(indices)
    if (!result) {
      const data = new Uint32Array(flatten(indices))
      result = {
        gpu: buffer({ data, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })._gpu,
        format: 'uint32',
        count: data.length
      }
      indexCache.set(indices, result)
    }
    return result
  }

  return { buffer, vertexBuffers, indexBuffer }
}
