struct Camera {
  projection: mat4x4f,
  view: mat4x4f,
  inverseView: mat4x4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var environment: texture_cube<f32>;
@group(1) @binding(1) var environmentSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) reflectionDirection: vec3f,
}

@vertex
fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
) -> VertexOutput {
  let eye = camera.inverseView * vec4f(0.0, 0.0, 0.0, 1.0);

  var output: VertexOutput;
  output.position = camera.projection * camera.view * vec4f(position, 1.0);
  output.reflectionDirection = reflect(
    normalize(position - eye.xyz / eye.w),
    normal,
  );
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(environment, environmentSampler, input.reflectionDirection);
}
