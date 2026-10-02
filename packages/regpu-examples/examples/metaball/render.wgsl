struct Vertex {
  position: vec4f,
  normal: vec4f,
};

struct Scene {
  projection: mat4x4f,
  view: mat4x4f,
  color: vec4f,
};

@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var<storage, read> vertices: array<Vertex>;
@group(0) @binding(2) var environment: texture_2d<f32>;
@group(0) @binding(3) var environmentSampler: sampler;
@group(0) @binding(4) var normalMap: texture_2d<f32>;
@group(0) @binding(5) var normalSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) objectPosition: vec3f,
  @location(1) objectNormal: vec3f,
  @location(2) viewNormal: vec3f,
  @location(3) viewPosition: vec3f,
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
  let vertex = vertices[index];
  let viewPosition = scene.view * vertex.position;
  var out: VertexOutput;
  out.position = scene.projection * viewPosition;
  out.objectPosition = vertex.position.xyz;
  out.objectNormal = vertex.normal.xyz;
  out.viewNormal = (scene.view * vec4f(vertex.normal.xyz, 0.0)).xyz;
  out.viewPosition = viewPosition.xyz;
  return out;
}

fn random(position: vec2f) -> f32 {
  return fract(sin(dot(position, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn environmentColor(ray: vec3f, normal: vec3f) -> vec3f {
  let reflected = reflect(normalize(ray), normalize(normal));
  let m = 2.0 * sqrt(dot(reflected.xy, reflected.xy) + (reflected.z + 1.0) * (reflected.z + 1.0));
  let uv = reflected.xy / max(m, 0.0001) + 0.5;
  return textureSample(environment, environmentSampler, uv).rgb;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  var weights = max((abs(normalize(in.objectNormal)) - 0.2) * 7.0, vec3f(0.0));
  weights /= max(weights.x + weights.y + weights.z, 0.0001);

  let bumpX = textureSample(normalMap, normalSampler, in.objectPosition.yz * 10.0).rgb;
  let bumpY = textureSample(normalMap, normalSampler, in.objectPosition.zx * 10.0).rgb;
  let bumpZ = textureSample(normalMap, normalSampler, in.objectPosition.xy * 10.0).rgb;
  var bump = normalize((bumpX * weights.x + bumpY * weights.y + bumpZ * weights.z) * 2.0 - 1.0);
  bump.y *= -1.0;

  let normal = normalize(in.viewNormal);
  let tangentX = vec3f(normal.x, -normal.z, normal.y);
  let tangentY = vec3f(normal.z, normal.y, -normal.x);
  let tangentZ = vec3f(-normal.y, normal.x, normal.z);
  let tangent = normalize(tangentX * weights.x + tangentY * weights.y + tangentZ * weights.z);
  let finalNormal = mat3x3f(tangent, normalize(cross(normal, tangent)), normal) * bump;

  var base = environmentColor(normalize(in.viewPosition), finalNormal);
  let rim = 1.75 * abs(dot(normal, normalize(-in.viewPosition)));
  base += 10.0 * base * scene.color.rgb * clamp(1.0 - rim, 0.0, 0.15);
  base = vec3f(1.0) - (vec3f(1.0) - base) * (vec3f(1.0) - base);
  base += vec3f(0.05 * random(in.position.xy));
  return vec4f(base, 1.0);
}
