import type * as REGPU from './types'
import type { MemberInfo, TypeInfo, VariableInfo } from 'wgsl_reflect'

export type UniformLayoutEntry = {
  name: string
  type: string
  offset: number
  size: number
}

export type UniformBindingLayout = {
  kind: 'uniform'
  name: string
  group: number
  binding: number
  source: 'root' | 'named'
  layout: UniformLayoutEntry[]
}

export type TextureBindingLayout = {
  kind: 'texture'
  name: string
  group: number
  binding: number
  view?: GPUTextureViewDescriptor
}

export type SamplerBindingLayout = {
  kind: 'sampler'
  name: string
  group: number
  binding: number
}

export type BufferBindingLayout = {
  kind: 'buffer'
  name: string
  group: number
  binding: number
}

export type BindingLayoutEntry =
  UniformBindingLayout | TextureBindingLayout | SamplerBindingLayout | BufferBindingLayout
export type BindGroupLayout = { group: number; entries: BindingLayoutEntry[] }

export type RenderPipelineResource = REGPU.RenderPipeline & {
  _layout?: {
    attributes?: Array<{
      name: string
      format: GPUVertexFormat
      stride: number
      location: number
      stepMode?: GPUVertexStepMode
    }>
    bindGroups?: BindGroupLayout[]
  }
}

export type ComputePipelineResource = REGPU.ComputePipeline & {
  _layout?: {
    bindGroups?: BindGroupLayout[]
  }
}

export function normalizeShaderTypeName(type: string): string {
  const genericVectorMatch = type.match(/^vec(\d)<f32>$/)

  if (genericVectorMatch) {
    return `vec${genericVectorMatch[1]}f`
  }

  const genericMatrixMatch = type.match(/^mat(\d)x(\d)<f32>$/)

  if (genericMatrixMatch) {
    return `mat${genericMatrixMatch[1]}x${genericMatrixMatch[2]}f`
  }

  return type
}

export function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

export function getVertexFormat(type: string): GPUVertexFormat {
  switch (normalizeShaderTypeName(type)) {
    case 'f32':
      return 'float32'
    case 'vec2f':
      return 'float32x2'
    case 'vec3f':
      return 'float32x3'
    case 'vec4f':
      return 'float32x4'
    default:
      throw new Error(`Unsupported vertex format: ${type}`)
  }
}

export function getTypeComponentCount(type: string): number {
  const normalized = normalizeShaderTypeName(type)
  switch (normalized) {
    case 'f32':
      return 1
    case 'vec2f':
      return 2
    case 'vec3f':
      return 3
    case 'vec4f':
      return 4
    default:
      throw new Error(`Unsupported vertex format: ${type}`)
  }
}

export function getUniformTypeInfo(type: string): { size: number; alignment: number } {
  const normalized = normalizeShaderTypeName(type)
  const array = normalized.match(/^array<\s*(.+)\s*,\s*(\d+)\s*>$/)

  if (array) {
    const element = getUniformTypeInfo(array[1])
    const count = Number(array[2])
    const alignment = Math.max(16, element.alignment)
    return {
      size: alignTo(element.size, alignment) * count,
      alignment
    }
  }

  switch (normalized) {
    case 'f32':
    case 'i32':
    case 'u32':
      return { size: 4, alignment: 4 }
    case 'vec2f':
    case 'vec2i':
    case 'vec2u':
      return { size: 8, alignment: 8 }
    case 'vec3f':
    case 'vec3i':
    case 'vec3u':
      return { size: 16, alignment: 16 }
    case 'vec4f':
    case 'vec4i':
    case 'vec4u':
      return { size: 16, alignment: 16 }
    case 'mat4x4f':
      return { size: 64, alignment: 16 }
    default:
      throw new Error(`Unsupported uniform format: ${type}`)
  }
}

export function createUniformLayout(layout?: Record<string, string>): UniformLayoutEntry[] {
  let offset = 0

  return Object.entries(layout ?? {}).map(([name, type]) => {
    const info = getUniformTypeInfo(type)
    offset = alignTo(offset, info.alignment)
    const entry = {
      name,
      type,
      offset,
      size: info.size
    }
    offset += info.size
    return entry
  })
}

export function createUniformLayoutEntry(
  name: string,
  type: string,
  offset: number,
  size?: number
): UniformLayoutEntry {
  const info = getUniformTypeInfo(type)

  return {
    name,
    type: normalizeShaderTypeName(type),
    offset,
    size: size && size > 0 ? size : info.size
  }
}

function getReflectedTypeName(type: TypeInfo): string {
  return type.getTypeName()
}

export function createUniformLayoutFromMembers(
  members: MemberInfo[] | null | undefined
): UniformLayoutEntry[] {
  let offset = 0

  return (members ?? []).map((member) => {
    const type = getReflectedTypeName(member.type)
    const info = getUniformTypeInfo(type)
    const canUseReflectedLayout =
      Number.isFinite(member.offset) &&
      Number.isFinite(member.size) &&
      member.size > 0 &&
      member.offset >= offset

    const entryOffset = canUseReflectedLayout ? member.offset : alignTo(offset, info.alignment)
    const entry = createUniformLayoutEntry(
      member.name,
      type,
      entryOffset,
      canUseReflectedLayout ? member.size : undefined
    )

    offset = entry.offset + entry.size
    return entry
  })
}

export function createUniformLayoutFromResource(resource: VariableInfo): UniformLayoutEntry[] {
  const members = createUniformLayoutFromMembers(resource.members)

  if (members.length) return members

  return [
    createUniformLayoutEntry(resource.name, getReflectedTypeName(resource.type), 0, resource.size)
  ]
}

export function isStructuredAttributeBinding(
  value: unknown
): value is { location?: number; type: string; stepMode?: GPUVertexStepMode } {
  return typeof value === 'object' && value !== null && 'type' in value
}

export function createAttributeLayouts(layout?: REGPU.PipelineAttributeLayout): Array<{
  name: string
  format: GPUVertexFormat
  stride: number
  location: number
  stepMode?: GPUVertexStepMode
}> {
  let nextLocation = 0

  return Object.entries(layout ?? {})
    .map(([name, value]) => {
      const binding = isStructuredAttributeBinding(value) ? value : { type: value }
      const location = binding.location ?? nextLocation

      nextLocation = Math.max(nextLocation, location + 1)

      return {
        name,
        format: getVertexFormat(binding.type),
        stride: Float32Array.BYTES_PER_ELEMENT * getTypeComponentCount(binding.type),
        location,
        stepMode: binding.stepMode
      }
    })
    .sort((a, b) => a.location - b.location)
}

export function getUniformBufferSize(layout?: UniformLayoutEntry[]): number {
  if (!layout?.length) return 0

  const last = layout[layout.length - 1]

  return alignTo(last.offset + last.size, 16)
}

export function isStructuredUniformBinding(
  value: unknown
): value is { group: number; binding: number; type: Record<string, string> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'group' in value &&
    'binding' in value &&
    'type' in value
  )
}

export function createUniformBindingLayouts(
  layout?: REGPU.PipelineUniformLayout
): UniformBindingLayout[] {
  if (!layout) return []

  const entries = Object.entries(layout)

  if (!entries.length) return []

  if (entries.every(([, value]) => typeof value === 'string')) {
    return [
      {
        kind: 'uniform',
        name: '__root__',
        group: 0,
        binding: 0,
        source: 'root',
        layout: createUniformLayout(layout as Record<string, string>)
      }
    ]
  }

  if (!entries.every(([, value]) => isStructuredUniformBinding(value))) {
    throw new Error('Mixed uniform specifications are unsupported')
  }

  return entries.map(([name, value]) => ({
    kind: 'uniform',
    name,
    group: value.group,
    binding: value.binding,
    source: 'named',
    layout: createUniformLayout(value.type)
  }))
}

export function createTextureBindingLayouts(
  layout?: REGPU.PipelineTextureLayout
): TextureBindingLayout[] {
  return Object.entries(layout ?? {}).map(([name, value]) => ({
    kind: 'texture',
    name,
    group: value.group,
    binding: value.binding,
    view: value.view
  }))
}

export function createSamplerBindingLayouts(
  layout?: REGPU.PipelineSamplerLayout
): SamplerBindingLayout[] {
  return Object.entries(layout ?? {}).map(([name, value]) => ({
    kind: 'sampler',
    name,
    group: value.group,
    binding: value.binding
  }))
}

export function createBufferBindingLayouts(
  layout?: REGPU.PipelineBufferLayout
): BufferBindingLayout[] {
  return Object.entries(layout ?? {}).map(([name, value]) => ({
    kind: 'buffer',
    name,
    group: value.group,
    binding: value.binding
  }))
}

export function createBindGroupLayouts(entries: BindingLayoutEntry[]): BindGroupLayout[] {
  const groups = new Map<number, BindingLayoutEntry[]>()

  for (const entry of entries) {
    const group = groups.get(entry.group)

    if (group) {
      group.push(entry)
    } else {
      groups.set(entry.group, [entry])
    }
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([group, groupEntries]) => ({
      group,
      entries: groupEntries.sort((a, b) => a.binding - b.binding)
    }))
}
