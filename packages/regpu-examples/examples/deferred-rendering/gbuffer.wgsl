struct Model {
  matrix: mat4x4f,
  normalMatrix: mat4x4f,
}
struct Camera {
  viewProjection: mat4x4f,
  inverseViewProjection: mat4x4f,
}
@group(0) @binding(0) var<uniform> model: Model;
@group(0) @binding(1) var<uniform> camera: Camera;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) uv: vec2f,
}
@vertex fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
) -> VertexOutput {
  var out: VertexOutput;
  let world = model.matrix * vec4f(position, 1);
  out.position = camera.viewProjection * world;
  out.normal = normalize((model.normalMatrix * vec4f(normal, 0)).xyz);
  out.uv = uv;
  return out;
}

struct GBufferOutput {
  @location(0) normal: vec4f,
  @location(1) albedo: vec4f,
}
@fragment fn fs_main(in: VertexOutput) -> GBufferOutput {
  let cell = floor(in.uv * 30);
  let checker = 0.2 + 0.5 * ((cell.x + cell.y) % 2);
  var out: GBufferOutput;
  out.normal = vec4f(normalize(in.normal), 1);
  out.albedo = vec4f(vec3f(checker), 1);
  return out;
}
