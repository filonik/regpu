struct Camera {
  projection: mat4x4f,
  view: mat4x4f,
  eye: vec3f,
}

struct Ground {
  height: f32,
  tiles: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> ground: Ground;

@vertex fn vs_main(@location(0) position: vec2f) -> VertexOutput {
  var output: VertexOutput;
  output.uv = position * ground.tiles;
  output.position = camera.projection * camera.view * vec4f(100.0 * position.x, ground.height, 100.0 * position.y, 1.0);
  return output;
}

@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let tile = step(vec2f(0.5), fract(input.uv));
  let shade = abs(tile.x - tile.y);
  return vec4f(vec3f(shade), 1.0);
}
