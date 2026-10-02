struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  const positions = array<vec2f, 3>(vec2f(0.0, 0.7), vec2f(- 0.7, - 0.7), vec2f(0.7, - 0.7));
  const colors = array<vec3f, 3>(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0));

  var out: VSOut;
  out.position = vec4f(positions[vid], 0.0, 1.0);
  out.color = colors[vid];
  return out;
}

@fragment
fn fs_main(@location(0) color: vec3f) -> @location(0) vec4f {
  return vec4f(color, 1.0);
}