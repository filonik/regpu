struct Light { position: vec4f, color: vec3f, radius: f32 }
struct Lights { values: array<Light> }
struct Config { count: u32 }
struct Extent { min: vec4f, max: vec4f }
@group(0) @binding(0) var<storage, read_write> lights: Lights;
@group(0) @binding(1) var<uniform> config: Config;
@group(0) @binding(2) var<uniform> extent: Extent;

@compute @workgroup_size(64) fn cs_main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= config.count) { return; }
  lights.values[id.x].position.y -= 0.5 + 0.003 * f32(id.x % 64);
  if (lights.values[id.x].position.y < extent.min.y) {
    lights.values[id.x].position.y = extent.max.y;
  }
}
