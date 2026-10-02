@group(0) @binding(0) var gBufferNormal: texture_2d<f32>;
@group(0) @binding(1) var gBufferAlbedo: texture_2d<f32>;
@group(0) @binding(2) var gBufferDepth: texture_depth_2d;

struct Light { position: vec4f, color: vec3f, radius: f32 }
struct Lights { values: array<Light> }
struct Config { count: u32 }
struct Camera { viewProjection: mat4x4f, inverseViewProjection: mat4x4f }
@group(1) @binding(0) var<storage, read> lights: Lights;
@group(1) @binding(1) var<uniform> config: Config;
@group(1) @binding(2) var<uniform> camera: Camera;

@vertex fn vs_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
                        vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
  return vec4f(positions[index], 0, 1);
}

@fragment fn fs_main(@builtin(position) coord: vec4f) -> @location(0) vec4f {
  let pixel = vec2i(coord.xy);
  let depth = textureLoad(gBufferDepth, pixel, 0);
  if (depth >= 1) { discard; }
  let size = vec2f(textureDimensions(gBufferDepth));
  let clip = vec4f(coord.x / size.x * 2 - 1, (1 - coord.y / size.y) * 2 - 1, depth, 1);
  let worldH = camera.inverseViewProjection * clip;
  let world = worldH.xyz / worldH.w;
  let normal = textureLoad(gBufferNormal, pixel, 0).xyz;
  let albedo = textureLoad(gBufferAlbedo, pixel, 0).rgb;
  var result = vec3f(0.2);
  for (var i = 0u; i < config.count; i++) {
    let delta = lights.values[i].position.xyz - world;
    let distance = length(delta);
    if (distance < lights.values[i].radius) {
      let diffuse = max(dot(normal, normalize(delta)), 0);
      let attenuation = pow(1 - distance / lights.values[i].radius, 2);
      result += diffuse * attenuation * lights.values[i].color * albedo;
    }
  }
  return vec4f(result, 1);
}
