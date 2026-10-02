import type * as REGPU from './types'

import {
  createReflectionCache,
  getReflectedEntry,
  getEntryResources,
  assertSupportedReflectedResources,
  createAttributeLayoutsFromReflection,
  createUniformBindingLayoutsFromReflection,
  createTextureBindingLayoutsFromReflection,
  createSamplerBindingLayoutsFromReflection,
  createBufferBindingLayoutsFromReflection
} from './reflection'
import {
  createAttributeLayouts,
  createBindGroupLayouts,
  createUniformBindingLayouts,
  createTextureBindingLayouts,
  createSamplerBindingLayouts,
  createBufferBindingLayouts,
  type RenderPipelineResource,
  type ComputePipelineResource
} from './layout'

function isShaderModule(value: unknown): value is REGPU.ShaderModule {
  return typeof value === 'object' && value !== null && '_gpu' in value
}

function isPipeline<T extends REGPU.ComputePipeline | REGPU.RenderPipeline>(
  value: unknown
): value is T {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_gpu' in value &&
    typeof value._gpu === 'object' &&
    value._gpu !== null &&
    'getBindGroupLayout' in value._gpu &&
    typeof value._gpu.getBindGroupLayout === 'function'
  )
}

function isRenderPipelineOptions(
  value: REGPU.RenderPipelineArg
): value is REGPU.RenderPipelineOptions {
  return typeof value === 'object' && value !== null && !('_gpu' in value) && !('code' in value)
}

function isComputePipelineOptions(
  value: REGPU.ComputePipelineArg
): value is REGPU.ComputePipelineOptions {
  return typeof value === 'object' && value !== null && !('_gpu' in value) && !('code' in value)
}

export function createREGPUPipelines(context: REGPU.Context) {
  const { device, format } = context

  const getShaderReflection = createReflectionCache()
  const moduleSources = new WeakMap<GPUShaderModule, string>()

  function getShaderCode(
    arg: REGPU.ShaderModule | REGPU.ShaderModuleArg | undefined
  ): string | undefined {
    if (!arg) return undefined
    if (isShaderModule(arg)) return moduleSources.get(arg._gpu)
    return typeof arg === 'string' ? arg : arg.code
  }

  function createModule(arg: REGPU.ShaderModuleArg): REGPU.ShaderModule {
    const code = typeof arg === 'string' ? arg : arg.code
    const desc: GPUShaderModuleDescriptor = {
      code,
      label: typeof arg === 'string' ? undefined : arg.label
    }
    const gpu = device.createShaderModule(desc)
    moduleSources.set(gpu, code)
    return { _gpu: gpu, destroy() {} }
  }

  function module(arg: REGPU.ShaderModule | REGPU.ShaderModuleArg): REGPU.ShaderModule {
    return isShaderModule(arg) ? arg : createModule(arg)
  }

  function createComputePipeline(arg: REGPU.ComputePipelineArg): ComputePipelineResource {
    const options = isComputePipelineOptions(arg) ? arg : undefined
    const moduleArg = isComputePipelineOptions(arg) ? arg.module : arg
    const shader = moduleArg ? module(moduleArg) : undefined
    const shaderCode = getShaderCode(moduleArg)
    const reflection = getShaderReflection(shaderCode)

    if (!shader) throw new Error('Missing compute module')

    const entryPoint = options?.entryPoint ?? 'cs_main'
    const needsReflectedBindings =
      !options?.uniforms || !options?.textures || !options?.samplers || !options?.buffers
    const entry =
      reflection && needsReflectedBindings
        ? getReflectedEntry(reflection.entry.compute, entryPoint, 'compute')
        : undefined
    const resources = getEntryResources(entry)

    if (reflection) {
      assertSupportedReflectedResources(resources)
    }

    const bindGroups = createBindGroupLayouts([
      ...(options?.uniforms
        ? createUniformBindingLayouts(options.uniforms)
        : createUniformBindingLayoutsFromReflection(resources)),
      ...(options?.textures
        ? createTextureBindingLayouts(options.textures)
        : createTextureBindingLayoutsFromReflection(resources)),
      ...(options?.samplers
        ? createSamplerBindingLayouts(options.samplers)
        : createSamplerBindingLayoutsFromReflection(resources)),
      ...(options?.buffers
        ? createBufferBindingLayouts(options.buffers)
        : createBufferBindingLayoutsFromReflection(resources))
    ])

    const desc: GPUComputePipelineDescriptor = {
      label: options?.label,
      layout: options?.layout ?? 'auto',
      compute: {
        module: shader._gpu,
        entryPoint
      }
    }
    const _gpu = device.createComputePipeline(desc)
    return {
      _gpu,
      _layout: {
        bindGroups
      },
      destroy() {}
    }
  }

  function computePipeline(
    arg: REGPU.ComputePipeline | REGPU.ComputePipelineArg
  ): REGPU.ComputePipeline {
    return isPipeline<REGPU.ComputePipeline>(arg) ? arg : createComputePipeline(arg)
  }

  function createRenderPipeline(arg: REGPU.RenderPipelineArg): RenderPipelineResource {
    const options = isRenderPipelineOptions(arg) ? arg : undefined
    const moduleArg = isRenderPipelineOptions(arg) ? arg.module : arg
    const shader = moduleArg ? module(moduleArg) : undefined
    const shaderCode = getShaderCode(moduleArg)
    const reflection = getShaderReflection(shaderCode)
    const vertexEntryPoint = options?.vertex?.entryPoint ?? 'vs_main'
    const fragmentEntryPoint = options?.fragment?.entryPoint ?? 'fs_main'
    const needsReflectedAttributes = !options?.attributes && !options?.vertex?.buffers
    const needsReflectedBindings =
      !options?.uniforms || !options?.textures || !options?.samplers || !options?.buffers
    const vertexEntry =
      reflection && (needsReflectedAttributes || needsReflectedBindings)
        ? getReflectedEntry(reflection.entry.vertex, vertexEntryPoint, 'vertex')
        : undefined
    const fragmentEntry =
      reflection && needsReflectedBindings
        ? getReflectedEntry(reflection.entry.fragment, fragmentEntryPoint, 'fragment')
        : undefined
    const resources = getEntryResources(vertexEntry, fragmentEntry)

    const vertexModule = options?.vertex?.module ?? shader?._gpu

    if (!vertexModule) throw new Error('Missing render module')

    if (reflection) {
      assertSupportedReflectedResources(resources)
    }

    const attributeEntries = options?.attributes
      ? createAttributeLayouts(options.attributes)
      : needsReflectedAttributes && vertexEntry
        ? createAttributeLayoutsFromReflection(vertexEntry)
        : []

    const bindGroups = createBindGroupLayouts([
      ...(options?.uniforms
        ? createUniformBindingLayouts(options.uniforms)
        : createUniformBindingLayoutsFromReflection(resources)),
      ...(options?.textures
        ? createTextureBindingLayouts(options.textures)
        : createTextureBindingLayoutsFromReflection(resources)),
      ...(options?.samplers
        ? createSamplerBindingLayouts(options.samplers)
        : createSamplerBindingLayoutsFromReflection(resources)),
      ...(options?.buffers
        ? createBufferBindingLayouts(options.buffers)
        : createBufferBindingLayoutsFromReflection(resources))
    ])

    const vertex: GPUVertexState = {
      ...options?.vertex,
      module: vertexModule,
      entryPoint: vertexEntryPoint,
      buffers:
        options?.vertex?.buffers ??
        attributeEntries.map((attribute) => ({
          arrayStride: attribute.stride,
          stepMode: attribute.stepMode,
          attributes: [
            {
              shaderLocation: attribute.location,
              offset: 0,
              format: attribute.format
            }
          ]
        }))
    }

    const fragmentModule = options?.fragment?.module ?? shader?._gpu
    const fragment: GPUFragmentState | undefined = fragmentModule
      ? {
          ...options?.fragment,
          module: fragmentModule,
          entryPoint: fragmentEntryPoint,
          targets: options?.fragment?.targets ?? [{ format, blend: options?.blend }]
        }
      : undefined

    const desc: GPURenderPipelineDescriptor = {
      label: options?.label,
      layout: options?.layout ?? 'auto',
      vertex,
      fragment,
      primitive: options?.primitive ?? {
        topology: 'triangle-list'
      },
      depthStencil:
        options?.depthStencil === null
          ? undefined
          : (options?.depthStencil ?? {
              format: 'depth24plus',
              depthWriteEnabled: true,
              depthCompare: 'less'
            })
    }

    return {
      _gpu: device.createRenderPipeline(desc),
      _layout: {
        attributes: attributeEntries,
        bindGroups
      },
      destroy() {}
    }
  }

  function renderPipeline(
    arg: REGPU.RenderPipeline | REGPU.RenderPipelineArg
  ): REGPU.RenderPipeline {
    return isPipeline<REGPU.RenderPipeline>(arg) ? arg : createRenderPipeline(arg)
  }

  return { module, renderPipeline, computePipeline }
}
