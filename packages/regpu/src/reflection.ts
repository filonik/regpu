/// <reference path="./wgsl-reflect.d.ts" />
import {
  ResourceType,
  WgslReflect,
  type FunctionInfo,
  type VariableInfo
} from 'wgsl_reflect/wgsl_reflect.module.js'
import {
  createUniformLayoutFromResource,
  getVertexFormat,
  getTypeComponentCount,
  type UniformBindingLayout,
  type TextureBindingLayout,
  type SamplerBindingLayout,
  type BufferBindingLayout
} from './layout'

export function getReflectedEntry(
  entries: FunctionInfo[],
  entryPoint: string,
  stage: string
): FunctionInfo {
  const entry = entries.find((candidate) => candidate.name === entryPoint)

  if (!entry) {
    throw new Error(`Missing ${stage} entry point: ${entryPoint}`)
  }

  return entry
}

export function createAttributeLayoutsFromReflection(
  entry: FunctionInfo | undefined
): Array<{
  name: string
  format: GPUVertexFormat
  stride: number
  location: number
  stepMode: GPUVertexStepMode
}> {
  return (entry?.inputs ?? [])
    .filter(
      (input) =>
        input.locationType === 'location' && typeof input.location === 'number' && input.type
    )
    .sort((a, b) => Number(a.location) - Number(b.location))
    .map((input) => ({
      name: input.name,
      format: getVertexFormat(input.type!.name),
      stride: Float32Array.BYTES_PER_ELEMENT * getTypeComponentCount(input.type!.name),
      location: Number(input.location),
      stepMode: 'vertex' as const
    }))
}

export function createUniformBindingLayoutsFromReflection(
  resources: VariableInfo[]
): UniformBindingLayout[] {
  return resources
    .filter((resource) => resource.resourceType === ResourceType.Uniform)
    .map((resource) => ({
      kind: 'uniform',
      name: resource.name,
      group: resource.group,
      binding: resource.binding,
      source: 'named',
      layout: createUniformLayoutFromResource(resource)
    }))
}

export function createTextureBindingLayoutsFromReflection(
  resources: VariableInfo[]
): TextureBindingLayout[] {
  return resources
    .filter(
      (resource) =>
        resource.resourceType === ResourceType.Texture ||
        resource.resourceType === ResourceType.StorageTexture
    )
    .map((resource) => ({
      kind: 'texture',
      name: resource.name,
      group: resource.group,
      binding: resource.binding
    }))
}

export function createSamplerBindingLayoutsFromReflection(
  resources: VariableInfo[]
): SamplerBindingLayout[] {
  return resources
    .filter((resource) => resource.resourceType === ResourceType.Sampler)
    .map((resource) => ({
      kind: 'sampler',
      name: resource.name,
      group: resource.group,
      binding: resource.binding
    }))
}

export function createBufferBindingLayoutsFromReflection(
  resources: VariableInfo[]
): BufferBindingLayout[] {
  return resources
    .filter((resource) => resource.resourceType === ResourceType.Storage)
    .map((resource) => ({
      kind: 'buffer',
      name: resource.name,
      group: resource.group,
      binding: resource.binding
    }))
}

export function assertSupportedReflectedResources(resources: VariableInfo[]) {
  for (const resource of resources) {
    if (
      resource.resourceType !== ResourceType.Uniform &&
      resource.resourceType !== ResourceType.Texture &&
      resource.resourceType !== ResourceType.StorageTexture &&
      resource.resourceType !== ResourceType.Sampler &&
      resource.resourceType !== ResourceType.Storage
    ) {
      throw new Error(`Unsupported reflected resource: ${resource.name}`)
    }
  }
}

export function getEntryResources(...entries: Array<FunctionInfo | undefined>): VariableInfo[] {
  const resources = new Map<string, VariableInfo>()

  for (const entry of entries) {
    for (const resource of entry?.resources ?? []) {
      resources.set(`${resource.group}:${resource.binding}`, resource)
    }
  }

  return Array.from(resources.values())
}

export function createReflectionCache() {
  const cache = new Map<string, WgslReflect>()
  return (code: string | undefined) => {
    if (!code) return undefined
    let reflection = cache.get(code)
    if (!reflection) {
      reflection = new WgslReflect(code)
      cache.set(code, reflection)
    }
    return reflection
  }
}
