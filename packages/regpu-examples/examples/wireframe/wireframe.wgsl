struct Uniforms {
  worldViewProjectionMatrix: mat4x4f,
  worldMatrix: mat4x4f,
  color: vec4f,
};

struct LineUniforms {
  stride: u32,
  thickness: f32,
  alphaThreshold: f32,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
};

struct LitOutput {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
};

@vertex fn vsLit(input: VertexInput) -> LitOutput {
  var output: LitOutput;
  output.position = uni.worldViewProjectionMatrix * vec4f(input.position, 1);
  output.normal = (uni.worldMatrix * vec4f(input.normal, 0)).xyz;
  return output;
}

@fragment fn fsLit(input: LitOutput) -> @location(0) vec4f {
  let lightDirection = normalize(vec3f(4, 10, 6));
  let light = dot(normalize(input.normal), lightDirection) * 0.5 + 0.5;
  return vec4f(uni.color.rgb * light, uni.color.a);
}

@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<uniform> line: LineUniforms;

struct WireOutput {
  @builtin(position) position: vec4f,
};

@vertex fn vsWire(@builtin(vertex_index) vertexIndex: u32) -> WireOutput {
  let triangle = vertexIndex / 6;
  let corner = (vertexIndex % 2 + vertexIndex / 2) % 3;
  let index = indices[triangle * 3 + corner];
  let positionIndex = index * line.stride;
  let position = vec4f(
    positions[positionIndex],
    positions[positionIndex + 1],
    positions[positionIndex + 2],
    1
  );
  var output: WireOutput;
  output.position = uni.worldViewProjectionMatrix * position;
  return output;
}

@fragment fn fsWire() -> @location(0) vec4f {
  return vec4f(min(uni.color.rgb + vec3f(0.5), vec3f(1)), 1);
}
