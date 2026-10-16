import type * as REGPU from './types'
import { createBindings } from './bindings'
import { createREGPUPipelines } from './pipeline'
import { createREGPUBuffers } from './buffer'
import { createFrameScheduler } from './frame'
import type { RenderPipelineResource, ComputePipelineResource } from './layout'

export function createCommandScopes(context: REGPU.Context) {
  const stack: REGPU.State[] = [{}]

  function resolve<P extends object>(state: REGPU.CommandState<P>, props: P): REGPU.State {
    return Object.fromEntries(
      Object.entries(state).map(([key, value]) => [
        key,
        typeof value === 'function' ? value(props, context) : value
      ])
    )
  }

  function compose(parent: REGPU.State, resolved: REGPU.State): REGPU.State {
    return {
      ...parent,
      ...resolved,
      uniforms: {
        ...(parent.uniforms as REGPU.Uniforms),
        ...(resolved.uniforms as REGPU.Uniforms)
      },
      textures: {
        ...(parent.textures as REGPU.Textures),
        ...(resolved.textures as REGPU.Textures)
      },
      samplers: {
        ...(parent.samplers as REGPU.Samplers),
        ...(resolved.samplers as REGPU.Samplers)
      },
      buffers: { ...(parent.buffers as REGPU.Buffers), ...(resolved.buffers as REGPU.Buffers) }
    }
  }

  function command<P extends object>(
    state: REGPU.CommandState<P>,
    execute: (current: REGPU.ResolvedCommandState) => void
  ): REGPU.Command<P> & REGPU.Scope<P> {
    function invoke(): void
    function invoke(props: P): void
    function invoke(body: REGPU.Callback): void
    function invoke(props: P, body: REGPU.Callback): void
    function invoke(propsOrBody: P | REGPU.Callback = {} as P, maybeBody?: REGPU.Callback) {
      const props = typeof propsOrBody === 'function' ? ({} as P) : propsOrBody
      const body = typeof propsOrBody === 'function' ? propsOrBody : maybeBody
      const current = compose(stack[stack.length - 1], resolve(state, props))
      stack.push(current)
      try {
        if (body) body()
        else execute(current)
      } finally {
        stack.pop()
      }
    }
    return invoke
  }

  return { command, resolve }
}

export function createREGPUCommands(
  context: REGPU.Context,
  pipelines: ReturnType<typeof createREGPUPipelines>,
  getDepthTexture: () => GPUTexture | undefined,
  getCanvasContexts: (context: REGPU.Context) => readonly REGPU.CanvasContext[]
) {
  const { device } = context
  const { module, renderPipeline, computePipeline } = pipelines
  const buffers = createREGPUBuffers(context)
  const { command, resolve } = createCommandScopes(context)
  const transientBuffers: GPUBuffer[] = []
  const { createBindingGroups } = createBindings(device, (buffer) => transientBuffers.push(buffer))

  let encoder: GPUCommandEncoder | undefined
  let activeComputePass: GPUComputePassEncoder | undefined
  let activeRenderPass: GPURenderPassEncoder | undefined

  function scope<P extends object>(
    state: REGPU.CommandState<P>,
    run: (resolved: REGPU.ResolvedCommandState, body: REGPU.Callback) => void
  ): REGPU.Scope<P> {
    function invoke(body: REGPU.Callback): void
    function invoke(props: P, body: REGPU.Callback): void
    function invoke(propsOrBody: P | REGPU.Callback, maybeBody?: REGPU.Callback) {
      if (!encoder) return
      const props = typeof propsOrBody === 'function' ? ({} as P) : propsOrBody
      const body = typeof propsOrBody === 'function' ? propsOrBody : maybeBody
      if (body) run(resolve(state, props), body)
    }
    return invoke
  }

  function computePass<P extends object>(state: REGPU.CommandState<P>): REGPU.Scope<P> {
    return scope(state, (_resolved, body) => {
      const pass = encoder!.beginComputePass({})
      activeComputePass = pass
      try {
        body()
      } finally {
        pass.end()
        activeComputePass = undefined
      }
    })
  }

  function renderPass<P extends object>(state: REGPU.CommandState<P>): REGPU.Scope<P> {
    return scope(state, (resolved, body) => {
      const toColorAttachment: (
        value: REGPU.Texture | REGPU.ColorAttachment
      ) => GPURenderPassColorAttachment = (value) => {
        const attachment = '_gpu' in value ? { view: value.view() } : value
        return {
          view: attachment.view,
          clearValue: attachment.clearValue ?? resolved.clear?.color ?? { r: 0, g: 0, b: 0, a: 1 },
          loadOp: attachment.loadOp ?? ('clear' as const),
          storeOp: attachment.storeOp ?? ('store' as const)
        }
      }
      const toColorAttachments: (
        values: (REGPU.Texture | REGPU.ColorAttachment)[]
      ) => GPURenderPassColorAttachment[] = (values) => values.map(toColorAttachment)
      const toDepthStencilAttachment: (
        value: REGPU.Texture | REGPU.DepthStencilAttachment | null
      ) => GPURenderPassDepthStencilAttachment | undefined = (value) => {
        if (value === null) return undefined
        const attachment = '_gpu' in value ? { view: value.view() } : value
        return {
          view: attachment.view,
          depthClearValue: attachment.depthClearValue ?? resolved.clear?.depth ?? 1,
          depthLoadOp: attachment.depthLoadOp ?? ('clear' as const),
          depthStoreOp: attachment.depthStoreOp ?? ('store' as const),
          stencilClearValue: attachment.stencilClearValue ?? resolved.clear?.stencil,
          stencilLoadOp: attachment.stencilLoadOp,
          stencilStoreOp: attachment.stencilStoreOp
        }
      }
      const defaultColorAttachments: () => GPURenderPassColorAttachment[] = () => {
        const texture = context.context.getCurrentTexture()
        return [toColorAttachment({ view: texture.createView() })]
      }
      const defaultDepthStencilAttachment: () =>
        GPURenderPassDepthStencilAttachment | undefined = () => {
        const texture = getDepthTexture()
        return texture ? toDepthStencilAttachment({ view: texture.createView() }) : undefined
      }

      const colorAttachments =
        resolved.colorAttachments === undefined
          ? defaultColorAttachments()
          : toColorAttachments(resolved.colorAttachments)

      const depthStencilAttachment =
        resolved.depthAttachment === undefined
          ? defaultDepthStencilAttachment()
          : toDepthStencilAttachment(resolved.depthAttachment)

      const pass = encoder!.beginRenderPass({
        colorAttachments,
        depthStencilAttachment
      })
      activeRenderPass = pass
      try {
        if (resolved.viewport) {
          const { x, y, width, height } = resolved.viewport
          pass.setViewport(x, y, width, height, 0, 1)
        }
        body()
      } finally {
        pass.end()
        activeRenderPass = undefined
      }
    })
  }

  function bind(
    pass: GPUComputePassEncoder | GPURenderPassEncoder,
    pipeline: ComputePipelineResource | RenderPipelineResource,
    state: REGPU.ResolvedCommandState
  ) {
    const groups = createBindingGroups(pipeline._gpu, pipeline._layout?.bindGroups, state)
    groups.forEach((group, index) => {
      pass.setBindGroup(pipeline._layout?.bindGroups?.[index]?.group ?? index, group)
    })
  }

  function computeCommand<P extends object>(
    state: REGPU.CommandState<P>
  ): REGPU.Command<P> & REGPU.Scope<P> {
    // Normalize static pipelines once, so scopes inherit a resource instead of
    // rebuilding a pipeline from shader source on every invocation.
    const normalized =
      state.pipeline && typeof state.pipeline !== 'function'
        ? { ...state, pipeline: computePipeline(state.pipeline as REGPU.ComputePipelineArg) }
        : state
    return command(normalized, (current) => {
      const pass = activeComputePass
      if (!pass) return
      const pipeline = current.pipeline
        ? (computePipeline(
            current.pipeline as REGPU.ComputePipeline | REGPU.ComputePipelineArg
          ) as ComputePipelineResource)
        : undefined
      if (pipeline) {
        pass.setPipeline(pipeline._gpu)
        bind(pass, pipeline, current)
      }
      if (current.indirect) pass.dispatchWorkgroupsIndirect(current.indirect._gpu, 0)
      else if (Array.isArray(current.count))
        pass.dispatchWorkgroups(current.count[0], current.count[1], current.count[2])
      else if (current.count !== undefined) pass.dispatchWorkgroups(current.count)
    })
  }

  function renderCommand<P extends object>(
    state: REGPU.CommandState<P>
  ): REGPU.Command<P> & REGPU.Scope<P> {
    const normalized =
      state.pipeline && typeof state.pipeline !== 'function'
        ? { ...state, pipeline: renderPipeline(state.pipeline as REGPU.RenderPipelineArg) }
        : state
    if (state.attributes && typeof state.attributes !== 'function')
      buffers.vertexBuffers(state.attributes)
    if (state.indices && typeof state.indices !== 'function') buffers.indexBuffer(state.indices)

    return command(normalized, (current) => {
      const pass = activeRenderPass
      if (!pass) return
      const pipeline = current.pipeline
        ? (renderPipeline(
            current.pipeline as REGPU.RenderPipeline | REGPU.RenderPipelineArg
          ) as RenderPipelineResource)
        : undefined
      if (pipeline) {
        pass.setPipeline(pipeline._gpu)
        bind(pass, pipeline, current)
      }
      const vertexBuffers = current.attributes && buffers.vertexBuffers(current.attributes)
      for (const [index, attribute] of (pipeline?._layout?.attributes ?? []).entries()) {
        const buffer = vertexBuffers?.[attribute.name]
        if (buffer) pass.setVertexBuffer(index, buffer)
      }
      const indexBuffer = current.indices && buffers.indexBuffer(current.indices)
      if (indexBuffer) pass.setIndexBuffer(indexBuffer.gpu, indexBuffer.format)

      // Apply the resolved value on every draw so nested scopes and sibling
      // commands restore their reference, including WebGPU's default of zero.
      pass.setStencilReference(current.stencilReference ?? 0)

      if (current.indirect) pass.drawIndirect(current.indirect._gpu, 0)
      else if (indexBuffer)
        pass.drawIndexed(
          typeof current.count === 'number' ? current.count : indexBuffer.count,
          current.instances
        )
      else pass.draw(typeof current.count === 'number' ? current.count : 0, current.instances)
    })
  }

  function submit(callback: REGPU.FrameCallback) {
    if (encoder) throw new Error('submit cannot be nested inside submit or a frame callback')
    encoder = device.createCommandEncoder()
    try {
      let canvasContexts: readonly REGPU.CanvasContext[] | undefined
      const frameContext: REGPU.FrameContext = {
        ...context,
        get canvasContexts() {
          return (canvasContexts ??= getCanvasContexts(frameContext))
        }
      }
      callback(frameContext)
      device.queue.submit([encoder.finish()])
    } finally {
      encoder = undefined
      // Buffers referenced by submitted work may be destroyed after submission.
      transientBuffers.splice(0).forEach((buffer) => buffer.destroy())
    }
  }

  const frame = createFrameScheduler(context, submit)

  return {
    module,
    compute: Object.assign(computeCommand, { pipeline: computePipeline, pass: computePass }),
    render: Object.assign(renderCommand, { pipeline: renderPipeline, pass: renderPass }),
    submit,
    frame
  }
}
