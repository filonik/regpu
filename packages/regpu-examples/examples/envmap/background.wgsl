struct Camera {
  view: mat4x4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var environment: texture_cube<f32>;
@group(1) @binding(1) var environmentSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) direction: vec3f,
}

@vertex
fn vs_main(@location(0) position: vec2f) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.direction = (camera.view * vec4f(position, 1.0, 0.0)).xyz;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(environment, environmentSampler, input.direction);
}
