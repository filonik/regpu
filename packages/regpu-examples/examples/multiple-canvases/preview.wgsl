struct Preview {
  matrix: mat4x4f,
  color: vec4f,
}

@group(0) @binding(0) var<uniform> preview: Preview;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) shade: f32,
}

@vertex fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
  let points = array<vec2f, 3>(vec2f(0.0, 0.65), vec2f(-0.58, -0.42), vec2f(0.58, -0.42));
  var out: VertexOut;
  out.position = preview.matrix * vec4f(points[index], 0.0, 1.0);
  out.shade = array<f32, 3>(1.0, 0.60, 0.86)[index];
  return out;
}

@fragment fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return vec4f(preview.color.rgb * in.shade, preview.color.a);
}
