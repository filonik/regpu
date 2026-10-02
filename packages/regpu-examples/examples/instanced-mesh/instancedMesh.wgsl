struct Camera {
  projection: mat4x4f,
  view: mat4x4f,
  time: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) color: vec3f,
}

@vertex
fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) offset: vec3f,
  @location(3) color: vec3f,
  @location(4) initialAngle: f32,
) -> VertexOutput {
  let angle = initialAngle + camera.time * 0.6;
  let cosine = cos(angle);
  let sine = sin(angle);
  let rotation = mat3x3f(
    cosine, 0, -sine,
    0, 1, 0,
    sine, 0, cosine,
  );
  let worldPosition = rotation * position + offset;

  var output: VertexOutput;
  output.position = camera.projection * camera.view * vec4f(worldPosition, 1);
  output.normal = rotation * normal;
  output.color = color;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let ambient = vec3f(0.3) * input.color;
  let lightDirection = vec3f(0.39, 0.87, 0.29);
  let diffuse = vec3f(0.7) * input.color * clamp(dot(input.normal, lightDirection), 0, 1);
  return vec4f(ambient + diffuse, 1);
}
