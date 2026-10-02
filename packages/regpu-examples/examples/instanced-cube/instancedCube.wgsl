struct Uniforms {
  modelViewProjectionMatrix: array<mat4x4f, 16>,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

@vertex
fn vs_main(
  @builtin(instance_index) instanceIndex: u32,
  @location(0) position: vec3f,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.modelViewProjectionMatrix[instanceIndex] * vec4f(position, 1);
  output.color = vec4f(position + vec3f(0.5), 1);
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  return input.color;
}
