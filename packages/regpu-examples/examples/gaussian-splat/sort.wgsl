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

struct SortParams { k: u32, j: u32, n: u32, pad: u32 };

@group(0) @binding(0) var<storage, read> params: SortParams;
@group(0) @binding(1) var<storage, read_write> entries: array<SortEntry>;

@compute @workgroup_size(256)
fn sort_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.n) { return; }
  let ixj = i ^ params.j;
  if (ixj <= i || ixj >= params.n) { return; }

  let ascending = (i & params.k) == 0u;
  let a = entries[i];
  let b = entries[ixj];
  let mustSwap = select((a.key < b.key), (a.key > b.key), ascending);
  if (mustSwap) {
    entries[i] = b;
    entries[ixj] = a;
  }
}
