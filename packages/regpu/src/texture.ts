import type * as REGPU from './types'

type TextureSource = GPUCopyExternalImageSourceInfo['source']

function isTexture(value: unknown): value is REGPU.Texture {
  return typeof value === 'object' && value !== null && '_gpu' in value
}

function isSampler(value: unknown): value is REGPU.Sampler {
  return typeof value === 'object' && value !== null && '_gpu' in value
}

function isTypedArray(value: unknown): value is REGPU.TypedArray {
  return ArrayBuffer.isView(value) && !(value instanceof DataView)
}

function isImageBitmap(value: unknown): value is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap
}

function isImageBitmapArray(value: unknown): value is ImageBitmap[] {
  return Array.isArray(value) && value.every((item) => isImageBitmap(item))
}

function flattenTextureData(data: REGPU.TextureArrayData): Uint8Array<ArrayBuffer> {
  if (isTypedArray(data)) {
    return new Uint8Array(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }

  const result: number[] = []

  function append(value: REGPU.TextureArrayData | number) {
    if (typeof value === 'number') {
      result.push(value)
      return
    }

    if (isTypedArray(value)) {
      result.push(...Array.from(value))
      return
    }

    for (const item of value) {
      append(item as REGPU.TextureArrayData | number)
    }
  }

  append(data)

  return new Uint8Array(result)
}

function getBytesPerPixel(format: GPUTextureFormat): number {
  switch (format) {
    case 'r8unorm':
    case 'r8snorm':
    case 'r8uint':
    case 'r8sint':
      return 1
    case 'rg8unorm':
    case 'rg8snorm':
    case 'rg8uint':
    case 'rg8sint':
      return 2
    case 'rgba8unorm':
    case 'rgba8unorm-srgb':
    case 'rgba8snorm':
    case 'rgba8uint':
    case 'rgba8sint':
    case 'bgra8unorm':
    case 'bgra8unorm-srgb':
      return 4
    default:
      throw new Error(`Unsupported texture format for data upload: ${format}`)
  }
}

function getSourceSize(source: TextureSource): [number, number, number] {
  if ('videoWidth' in source && 'videoHeight' in source) {
    return [source.videoWidth, source.videoHeight, 1]
  }

  if ('displayWidth' in source && 'displayHeight' in source) {
    return [source.displayWidth, source.displayHeight, 1]
  }

  return [source.width, source.height, 1]
}

function createTextureResource(
  texture: GPUTexture,
  viewDescriptor?: GPUTextureViewDescriptor
): REGPU.Texture {
  const defaultView = texture.createView(viewDescriptor)

  return {
    _gpu: texture,
    view(descriptor) {
      return descriptor ? texture.createView(descriptor) : defaultView
    },
    destroy() {
      texture.destroy()
    }
  }
}

export function createREGPUTextures(context: REGPU.Context) {
  const { device } = context

  function createTextureDescriptor(
    size: GPUExtent3D,
    options: REGPU.TextureOptions
  ): GPUTextureDescriptor {
    return {
      size,
      format: options.format ?? 'rgba8unorm',
      dimension: options.dimension ?? '2d',
      mipLevelCount: 1,
      usage: options.usage ?? GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    }
  }

  function createTexture(arg: REGPU.TextureArg): REGPU.Texture {
    if (isImageBitmap(arg.data)) {
      return createTextureFromSources([arg.data], arg)
    }

    if (isImageBitmapArray(arg.data)) {
      return createTextureFromSources(arg.data, arg)
    }

    const width = arg.shape?.[0]
    const height = arg.shape?.[1]

    if (!width || !height) {
      throw new Error('Texture shape must include width and height')
    }

    const size: GPUExtent3D = [width, height, arg.shape?.[2] ?? 1]
    const descriptor = createTextureDescriptor(size, arg)
    const texture = device.createTexture(descriptor)

    if (arg.data) {
      const bytes = flattenTextureData(arg.data)
      const bytesPerRow = width * getBytesPerPixel(descriptor.format)

      device.queue.writeTexture({ texture }, bytes, { bytesPerRow, rowsPerImage: height }, size)
    }

    return createTextureResource(texture, arg.view)
  }

  function createTextureFromSources(
    sources: TextureSource[],
    options: REGPU.TextureOptions = {}
  ): REGPU.Texture {
    if (!sources.length) {
      throw new Error('At least one texture source is required')
    }

    const sourceSize = getSourceSize(sources[0])
    const size = [sourceSize[0], sourceSize[1], options.shape?.[2] ?? sources.length]
    const descriptor = createTextureDescriptor(size, {
      ...options,
      usage:
        (options.usage ?? 0) |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT
    })
    const texture = device.createTexture(descriptor)
    const originLayer = options.baseArrayLayer ?? 0

    sources.forEach((source, layer) => {
      const copySize = getSourceSize(source)

      if (copySize[0] !== size[0] || copySize[1] !== size[1]) {
        throw new Error('All texture sources must have the same dimensions')
      }

      device.queue.copyExternalImageToTexture(
        { source, flipY: options.flipY },
        {
          texture,
          origin: [0, 0, originLayer + layer],
          premultipliedAlpha: options.premultipliedAlpha,
          colorSpace: options.colorSpace
        },
        copySize
      )
    })

    const view = options.view ?? (sources.length === 6 ? { dimension: 'cube' as const } : undefined)

    return createTextureResource(texture, view)
  }

  function texture(arg: REGPU.Texture | REGPU.TextureArg): REGPU.Texture {
    return isTexture(arg) ? arg : createTexture(arg)
  }

  function createSampler(arg?: REGPU.SamplerArg): REGPU.Sampler {
    const _gpu = device.createSampler(arg)
    return {
      _gpu,
      destroy() {}
    }
  }

  function sampler(arg?: REGPU.Sampler | REGPU.SamplerArg): REGPU.Sampler {
    return isSampler(arg) ? arg : createSampler(arg)
  }

  return {
    texture,
    sampler
  }
}
