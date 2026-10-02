struct Vertex {
  position: vec4f,
  normal: vec4f,
};

struct Scene {
  viewProjection: mat4x4f,
  eye: vec4f,
};

@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var<storage, read> vertices: array<Vertex>;
@group(0) @binding(2) var ground: texture_2d<f32>;
@group(0) @binding(3) var mud: texture_2d<f32>;
@group(0) @binding(4) var rock: texture_2d<f32>;
@group(0) @binding(5) var groundNormal: texture_2d<f32>;
@group(0) @binding(6) var mudNormal: texture_2d<f32>;
@group(0) @binding(7) var rockNormal: texture_2d<f32>;
@group(0) @binding(8) var materialSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
  let vertex = vertices[index];
  var out: VertexOutput;
  out.position = scene.viewProjection * vertex.position;
  out.worldPosition = vertex.position.xyz;
  out.normal = vertex.normal.xyz;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let geometricNormal = normalize(in.normal);
  var weights = pow(abs(geometricNormal), vec3f(5));
  weights /= max(dot(weights, vec3f(1)), 0.0001);
  let uv = in.worldPosition * 0.55;
  let albedoX = textureSample(rock, materialSampler, uv.yz).rgb;
  let albedoY = textureSample(ground, materialSampler, uv.zx).rgb;
  let albedoZ = textureSample(mud, materialSampler, uv.xy).rgb;
  let albedo = albedoX * weights.x + albedoY * weights.y + albedoZ * weights.z;

  let detailX = textureSample(rockNormal, materialSampler, uv.yz).rgb * 2.0 - 1.0;
  let detailY = textureSample(groundNormal, materialSampler, uv.zx).rgb * 2.0 - 1.0;
  let detailZ = textureSample(mudNormal, materialSampler, uv.xy).rgb * 2.0 - 1.0;
  let mappedX = vec3f(detailX.z, detailX.y, detailX.x * sign(geometricNormal.x));
  let mappedY = vec3f(detailY.x, detailY.z, detailY.y * sign(geometricNormal.y));
  let mappedZ = vec3f(detailZ.x * sign(geometricNormal.z), detailZ.y, detailZ.z);
  let normal = normalize(mappedX * weights.x + mappedY * weights.y + mappedZ * weights.z);
  let light = normalize(vec3f(0.5, 0.9, 0.35));
  let view = normalize(scene.eye.xyz - in.worldPosition);
  let diffuse = max(dot(normal, light), 0.0);
  let rim = pow(1.0 - max(dot(normal, view), 0.0), 2.5);
  let halfVector = normalize(light + view);
  let specular = pow(max(dot(normal, halfVector), 0.0), 48.0);
  let color = albedo * (0.22 + 0.9 * diffuse) + rim * albedo * 0.3;
  return vec4f(color + specular * 0.35, 1.0);
}
