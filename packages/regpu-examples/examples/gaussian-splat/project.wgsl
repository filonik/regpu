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
@group(0) @binding(1) var<storage, read> gaussians: array<Gaussian>;
@group(0) @binding(2) var<storage, read_write> splats: array<Splat>;
@group(0) @binding(3) var<storage, read_write> sortEntries: array<SortEntry>;

const FAR_AWAY: f32 = 1.0e30; // sort key for culled splats — pushes them to the end

fn cull(i: u32) {
  splats[i].data0 = vec4f(0.0, 0.0, 0.0, 0.0); // radius = 0 -> invisible
  sortEntries[i] = SortEntry(FAR_AWAY, i);
}

@compute @workgroup_size(256)
fn project_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&gaussians)) { return; }
  let g = gaussians[i];

  let viewPos = (uniforms.viewMatrix * vec4f(g.position.xyz, 1.0)).xyz;
  let dist = -viewPos.z; // camera looks down -Z, so distance-in-front is positive
  if (dist < 0.2) { cull(i); return; }

  let clipPos = uniforms.projMatrix * vec4f(viewPos, 1.0);
  let ndc = clipPos.xyz / clipPos.w;
  if (abs(ndc.x) > 1.3 || abs(ndc.y) > 1.3) { cull(i); return; }

  // --- 3D covariance, transformed into view space ---
  let cov3d = computeCov3D(g.scale.xyz, g.rotation);
  let W = mat3x3f(uniforms.viewMatrix[0].xyz, uniforms.viewMatrix[1].xyz, uniforms.viewMatrix[2].xyz);
  let covView = W * cov3d * transpose(W);

  // --- linearized perspective projection (Jacobian), EWA splatting ---
  let focal = uniforms.screenParams.zw;
  let J = mat3x3f(
    vec3f(focal.x / dist, 0.0, 0.0),
    vec3f(0.0, focal.y / dist, 0.0),
    vec3f(-focal.x * viewPos.x / (dist * dist), -focal.y * viewPos.y / (dist * dist), 0.0),
  );
  let covScreen = J * covView * transpose(J);

  // Small diagonal bias keeps tiny/degenerate splats from disappearing (acts like a low-pass filter).
  let a = covScreen[0][0] + 0.3;
  let b = covScreen[0][1];
  let c = covScreen[1][1] + 0.3;

  let det = a * c - b * b;
  if (det <= 0.0) { cull(i); return; }

  // Inverse of the 2x2 covariance ("conic"), used by the fragment shader to
  // evaluate the gaussian: exponent = -0.5 * [dx dy] * conic * [dx dy]^T
  let invDet = 1.0 / det;
  let conic = vec3f(c * invDet, -b * invDet, a * invDet);

  // Bounding radius: 3 standard deviations along the covariance's major axis.
  let mid = 0.5 * (a + c);
  let lambda1 = mid + sqrt(max(0.1, mid * mid - det));
  let radius = ceil(3.0 * sqrt(max(lambda1, 0.0)));

  let screenX = (ndc.x * 0.5 + 0.5) * uniforms.screenParams.x;
  let screenY = (1.0 - (ndc.y * 0.5 + 0.5)) * uniforms.screenParams.y;

  // Gentle twinkle, just to show the compute pass re-runs every frame.
  let twinkle = 0.75 + 0.25 * sin(uniforms.timeParams.x * 5.0 + f32(i) * 0.25);

  splats[i].data0 = vec4f(screenX, screenY, radius, g.colorOpacity.w * twinkle);
  splats[i].data1 = vec4f(conic, 0.0);
  splats[i].data2 = vec4f(g.colorOpacity.rgb, 0.0);
  sortEntries[i] = SortEntry(-dist, i);
}
