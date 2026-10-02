import type * as REGPU from './types'
import { createBindings } from './bindings'
import { createREGPUPipelines } from './pipeline'
import { createREGPUBuffers } from './buffer'
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
  getDepthTexture: () => GPUTexture | undefined
) {
  const { device, context: canvasContext } = context
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
      const depthTexture =
        resolved.depthAttachment === null
          ? undefined
          : (resolved.depthAttachment?._gpu ?? getDepthTexture())
      const colorAttachments = resolved.colorAttachments?.map((attachment) => {
        const descriptor = '_gpu' in attachment ? { view: attachment.view() } : attachment
        return {
          view: descriptor.view,
          clearValue: descriptor.clear ?? resolved.clear?.color ?? { r: 0, g: 0, b: 0, a: 1 },
          loadOp: descriptor.loadOp ?? ('clear' as const),
          storeOp: descriptor.storeOp ?? ('store' as const)
        }
      })
      const pass = encoder!.beginRenderPass({
        colorAttachments: colorAttachments ?? [
          {
            view: canvasContext.getCurrentTexture().createView(),
            clearValue: resolved.clear?.color ?? { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ],
        depthStencilAttachment: depthTexture && {
          view: resolved.depthAttachment?.view() ?? depthTexture.createView(),
          depthClearValue: resolved.clear?.depth ?? 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store'
        }
      })
      activeRenderPass = pass
      try {
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

      if (current.indirect) pass.drawIndirect(current.indirect._gpu, 0)
      else if (indexBuffer)
        pass.drawIndexed(
          typeof current.count === 'number' ? current.count : indexBuffer.count,
          current.instances
        )
      else pass.draw(typeof current.count === 'number' ? current.count : 0, current.instances)
    })
  }

  function frame(callback: REGPU.FrameCallback) {
    let previousTime: number | undefined

    function loop(ms: number) {
      context.time = ms * 0.001
      context.delta = previousTime === undefined ? 0 : context.time - previousTime
      previousTime = context.time
      encoder = device.createCommandEncoder()
      try {
        callback(context)
        device.queue.submit([encoder.finish()])
      } finally {
        encoder = undefined
        // Buffers referenced by submitted work may be destroyed after submission.
        // Unlike static vertex/index resources, uniform uploads live for one frame.
        transientBuffers.splice(0).forEach((buffer) => buffer.destroy())
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  return {
    module,
    compute: Object.assign(computeCommand, { pipeline: computePipeline, pass: computePass }),
    render: Object.assign(renderCommand, { pipeline: renderPipeline, pass: renderPass }),
    frame
  }
}
