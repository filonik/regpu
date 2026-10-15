// @types/webxr supplies the standard XR globals, but not this experimental binding.
export interface XRGPUSubImage extends XRSubImage {
  readonly colorTexture: GPUTexture
  getViewDescriptor(): GPUTextureViewDescriptor
}

export interface XRGPUBinding {
  createProjectionLayer(options: { colorFormat: GPUTextureFormat }): XRProjectionLayer
  getViewSubImage(layer: XRProjectionLayer, view: XRView): XRGPUSubImage
}

export interface XRGPUBindingConstructor {
  new (session: XRSession, device: GPUDevice): XRGPUBinding
  prototype: XRGPUBinding
}
