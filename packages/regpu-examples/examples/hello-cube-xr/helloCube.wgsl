struct Uniforms {
  projection: mat4x4f,
  view: mat4x4f,
  model: mat4x4f
}

@group(0) @binding(0)
var<uniform> u: Uniforms;

struct VSIn {
  @location(0) position: vec3f,
  @location(1) texCoord: vec2f,
}

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
};

@vertex
fn vs_main(in: VSIn) -> VSOut {
  var out: VSOut;
  out.position = u.projection  * u.view * u.model * vec4f(in.position, 1);
  out.texCoord = in.texCoord;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  return vec4f(in.texCoord, 1.0, 1.0);
}