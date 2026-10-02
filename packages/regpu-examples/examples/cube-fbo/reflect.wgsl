struct Camera {
  projection: mat4x4f,
  view: mat4x4f,
  eye: vec3f,
}

struct Object {
  model: mat4x4f,
  tint: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
@group(0) @binding(2) var environment: texture_cube<f32>;
@group(0) @binding(3) var environmentSampler: sampler;

@vertex fn vs_main(@location(0) position: vec3f, @location(1) normal: vec3f) -> VertexOutput {
  let worldPosition = object.model * vec4f(position, 1.0);
  var output: VertexOutput;
  output.position = camera.projection * camera.view * worldPosition;
  output.worldPosition = worldPosition.xyz;
  output.normal = normalize((object.model * vec4f(normal, 0.0)).xyz);
  return output;
}

@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let eyeDirection = normalize(camera.eye - input.worldPosition);
  let reflected = reflect(-eyeDirection, normalize(input.normal));
  return vec4f(textureSample(environment, environmentSampler, reflected).rgb * object.tint, 1.0);
}
