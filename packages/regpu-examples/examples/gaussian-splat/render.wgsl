struct Gaussian {
  position: vec4f, // xyz = world position
  scale: vec4f,    // xyz = per-axis standard deviation
  rotation: vec4f, // orientation quaternion (x, y, z, w)
  colorOpacity: vec4f, // rgb = color, a = opacity
};

// Everything a splat needs at draw time, produced by the project pass.
struct Splat {
  data0: vec4f, // xy = screen-space pixel center, z = pixel radius, w = opacity
  data1: vec4f, // xyz = 2D conic (inverse covariance: A, B, C)
  data2: vec4f, // xyz = color
};

struct SortEntry {
  key: f32,   // negative view-space distance -> ascending sort = back-to-front
  index: u32, // index into the Gaussian / Splat arrays
};

struct Uniforms {
  viewMatrix: mat4x4f,
  projMatrix: mat4x4f,
  screenParams: vec4f, // width, height, focalX, focalY (pixels)
  timeParams: vec4f,   // time (seconds), unused, unused, unused
};

// Builds a rotation matrix from a unit quaternion.
fn quatToMat3(q: vec4f) -> mat3x3f {
  let x = q.x; let y = q.y; let z = q.z; let w = q.w;
  let x2 = x + x; let y2 = y + y; let z2 = z + z;
  let xx = x * x2; let xy = x * y2; let xz = x * z2;
  let yy = y * y2; let yz = y * z2; let zz = z * z2;
  let wx = w * x2; let wy = w * y2; let wz = w * z2;
  return mat3x3f(
    vec3f(1.0 - (yy + zz), xy + wz, xz - wy),
    vec3f(xy - wz, 1.0 - (xx + zz), yz + wx),
    vec3f(xz + wy, yz - wx, 1.0 - (xx + yy)),
  );
}

// World-space 3D covariance matrix Sigma = R * S * S^T * R^T of a gaussian.
fn computeCov3D(scale: vec3f, rotation: vec4f) -> mat3x3f {
  let R = quatToMat3(rotation);
  let M = mat3x3f(R[0] * scale.x, R[1] * scale.y, R[2] * scale.z);
  return M * transpose(M);
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> splats: array<Splat>;
@group(0) @binding(2) var<storage, read> sortEntries: array<SortEntry>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) opacity: f32,
  @location(2) conic: vec3f,
  @location(3) delta: vec2f, // fragment's offset from splat center, in pixels
};

@vertex
fn vs_main(@builtin(vertex_index) vIdx: u32, @builtin(instance_index) iIdx: u32) -> VertexOutput {
  // sortEntries gives us the draw order; .index tells us which splat to fetch.
  let splat = splats[sortEntries[iIdx].index];
  let radius = splat.data0.z;

  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
  );
  let delta = corners[vIdx] * radius;
  let pixelPos = splat.data0.xy + delta;

  var out: VertexOutput;
  if (radius <= 0.0) {
    out.position = vec4f(0.0, 0.0, -2.0, 1.0); // outside the clip volume -> discarded
  } else {
    let ndcX = (pixelPos.x / uniforms.screenParams.x) * 2.0 - 1.0;
    let ndcY = 1.0 - (pixelPos.y / uniforms.screenParams.y) * 2.0;
    out.position = vec4f(ndcX, ndcY, 0.5, 1.0);
  }
  out.color = splat.data2.xyz;
  out.opacity = splat.data0.w;
  out.conic = splat.data1.xyz;
  out.delta = delta;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let d = in.delta;
  // Evaluate the 2D gaussian: exponent = -0.5 * d^T * conic * d
  let power = -0.5 * (in.conic.x * d.x * d.x + in.conic.z * d.y * d.y) - in.conic.y * d.x * d.y;
  if (power > 0.0) { discard; }
  let alpha = clamp(in.opacity * exp(power), 0.0, 0.99);
  if (alpha < 1.0 / 255.0) { discard; }
  return vec4f(in.color * alpha, alpha); // premultiplied, for back-to-front "over" blending
}
