struct Camera {
  projection : mat4x4f,
  view : mat4x4f,
};

struct Model {
  transform: mat4x4f,
};

@group(0) @binding(0) var<uniform> camera: Camera;

@group(1) @binding(0) var baseColor: texture_2d<f32>;
@group(1) @binding(1) var baseColorSampler: sampler;

@group(2) @binding(0) var<uniform> model: Model;

// The remainder of this shader doesn't affect the bind groups.
struct VSIn {
  @location(0) position: vec3f,
  @location(1) texCoord: vec2f,
}

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) texCoord : vec2f,
};

@vertex
fn vs_main(in: VSIn) -> VSOut {
  var out: VSOut;
  out.position = camera.projection * camera.view * model.transform * vec4f(in.position, 1);
  out.texCoord = in.texCoord;
  return out;
}

// The remainder of this shader doesn't affect the bind groups.
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  return textureSample(baseColor, baseColorSampler, in.texCoord);
}