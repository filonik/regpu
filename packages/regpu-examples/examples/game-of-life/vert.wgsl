@binding(0) @group(0) var<storage, read> size: vec2u;
@binding(1) @group(0) var<storage, read> cells: array<u32>;
struct Out { @builtin(position) pos: vec4f, @location(0) cell: f32 }
@vertex
fn vs_main(@builtin(instance_index) i: u32, @builtin(vertex_index) vertex: u32) -> Out {
  let positions = array<vec2u, 4>(vec2u(0, 0), vec2u(0, 1), vec2u(1, 0), vec2u(1, 1));
  let cell = cells[i];
  let pos = positions[vertex];
  let w = size.x;
  let h = size.y;
  let x = (f32(i % w + pos.x) / f32(w) - 0.5) * 2. * f32(w) / f32(max(w, h));
  let y = (f32((i - (i % w)) / w + pos.y) / f32(h) - 0.5) * 2. * f32(h) / f32(max(w, h));
  return Out(vec4f(x, y, 0., 1.), f32(cell));
}
