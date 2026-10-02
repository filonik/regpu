struct Params {
  values: vec4f, // time, grid resolution, world size, vertex capacity
};

struct Vertex {
  position: vec4f,
  normal: vec4f,
};

struct DrawArgs {
  vertexCount: atomic<u32>,
  instanceCount: u32,
  firstVertex: u32,
  firstInstance: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> vertices: array<Vertex>;
@group(0) @binding(2) var<storage, read_write> drawArgs: DrawArgs;

const TETRAHEDRA = array<vec4u, 6>(
  vec4u(0, 5, 1, 6), vec4u(0, 1, 2, 6), vec4u(0, 2, 3, 6),
  vec4u(0, 3, 7, 6), vec4u(0, 7, 4, 6), vec4u(0, 4, 5, 6),
);
const EDGE_A = array<u32, 6>(0, 1, 2, 0, 1, 2);
const EDGE_B = array<u32, 6>(1, 2, 0, 3, 3, 3);

// Seven entries per case: two edge-index triangles terminated by -1.
const TRIANGLES = array<i32, 112>(
  -1,-1,-1,-1,-1,-1,-1, 0,3,2,-1,-1,-1,-1,
  0,1,4,-1,-1,-1,-1, 1,4,2,2,4,3,-1,
  1,2,5,-1,-1,-1,-1, 0,3,5,0,5,1,-1,
  0,2,5,0,5,4,-1, 5,4,3,-1,-1,-1,-1,
  3,4,5,-1,-1,-1,-1, 4,5,0,5,2,0,-1,
  1,5,0,5,3,0,-1, 5,2,1,-1,-1,-1,-1,
  3,4,2,2,4,1,-1, 4,1,0,-1,-1,-1,-1,
  2,3,0,-1,-1,-1,-1, -1,-1,-1,-1,-1,-1,-1,
);

fn rotateAxisAngle(axisValue: vec3f, angle: f32) -> mat3x3f {
  let axis = normalize(axisValue);
  let c = cos(angle);
  let s = sin(angle);
  let t = 1.0 - c;
  return mat3x3f(
    t*axis.x*axis.x+c, t*axis.x*axis.y+s*axis.z, t*axis.x*axis.z-s*axis.y,
    t*axis.x*axis.y-s*axis.z, t*axis.y*axis.y+c, t*axis.y*axis.z+s*axis.x,
    t*axis.x*axis.z+s*axis.y, t*axis.y*axis.z-s*axis.x, t*axis.z*axis.z+c,
  );
}

fn roundedBox(p: vec3f, bounds: vec3f, radius: f32) -> f32 {
  return length(max(abs(p) - bounds, vec3f(0))) - radius;
}

fn torus(p: vec3f, radii: vec2f) -> f32 {
  return length(vec2f(length(p.xz) - radii.x, p.y)) - radii.y;
}

fn smoothUnion(a: f32, b: f32, amount: f32) -> f32 {
  let k = max(amount, 0.05);
  return -log(exp(-k * a) + exp(-k * b)) / k;
}

// A scaled version of the source demo's rounded box + helical cut + torus SDF.
fn density(ws: vec3f) -> f32 {
  let time = params.values.x;
  let radius = 0.68;
  var p = rotateAxisAngle(vec3f(1, 0, 1), 0.785) * ws;
  var d = roundedBox(p, vec3f(radius), radius * 0.125);
  let helixScale = 2.9;
  let helix = vec2f(cos(helixScale * ws.y), sin(helixScale * ws.y));
  d += max(dot(helix, helixScale * 0.18 * ws.xz), d);
  p = rotateAxisAngle(vec3f(1), time * 0.12) * ws.yzx;
  let ringVariation = 0.16 * sin(time);
  return smoothUnion(d, torus(p, vec2f(1.43, 0.28 + ringVariation)), 6.0);
}

fn densityNormal(p: vec3f) -> vec3f {
  let e = 0.006;
  return normalize(vec3f(
    density(p + vec3f(e, 0, 0)) - density(p - vec3f(e, 0, 0)),
    density(p + vec3f(0, e, 0)) - density(p - vec3f(0, e, 0)),
    density(p + vec3f(0, 0, e)) - density(p - vec3f(0, 0, e))
  ));
}

fn interpolate(a: vec3f, b: vec3f, da: f32, db: f32) -> vec3f {
  return mix(a, b, clamp(da / (da - db), 0.0, 1.0));
}

fn emitTriangle(a: vec3f, b: vec3f, c: vec3f) {
  let base = atomicAdd(&drawArgs.vertexCount, 3u);
  if (base + 2u >= u32(params.values.w)) { return; }
  let na = densityNormal(a);
  let nb = densityNormal(b);
  let nc = densityNormal(c);
  if (dot(cross(b - a, c - a), na + nb + nc) < 0.0) {
    vertices[base] = Vertex(vec4f(a, 1), vec4f(na, 0));
    vertices[base + 1u] = Vertex(vec4f(c, 1), vec4f(nc, 0));
    vertices[base + 2u] = Vertex(vec4f(b, 1), vec4f(nb, 0));
  } else {
    vertices[base] = Vertex(vec4f(a, 1), vec4f(na, 0));
    vertices[base + 1u] = Vertex(vec4f(b, 1), vec4f(nb, 0));
    vertices[base + 2u] = Vertex(vec4f(c, 1), vec4f(nc, 0));
  }
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
  let resolution = u32(params.values.y);
  let cellCount = resolution * resolution * resolution;
  if (id.x >= cellCount) { return; }

  let cell = vec3u(id.x % resolution, (id.x / resolution) % resolution, id.x / (resolution * resolution));
  let step = params.values.z / f32(resolution);
  let origin = vec3f(cell) * step - vec3f(params.values.z * 0.5);
  let offsets = array<vec3f, 8>(
    vec3f(0,0,0), vec3f(1,0,0), vec3f(1,1,0), vec3f(0,1,0),
    vec3f(0,0,1), vec3f(1,0,1), vec3f(1,1,1), vec3f(0,1,1),
  );
  var positions: array<vec3f, 8>;
  var values: array<f32, 8>;
  for (var corner = 0u; corner < 8u; corner++) {
    positions[corner] = origin + offsets[corner] * step;
    values[corner] = density(positions[corner]);
  }

  for (var tetraIndex = 0u; tetraIndex < 6u; tetraIndex++) {
    let tetra = TETRAHEDRA[tetraIndex];
    var p: array<vec3f, 4>;
    var d: array<f32, 4>;
    var mask = 0u;
    for (var i = 0u; i < 4u; i++) {
      p[i] = positions[tetra[i]];
      d[i] = values[tetra[i]];
      if (d[i] < 0.0) { mask |= 1u << i; }
    }
    let tableOffset = mask * 7u;
    for (var triangle = 0u; triangle < 6u; triangle += 3u) {
      let firstEdge = TRIANGLES[tableOffset + triangle];
      if (firstEdge < 0) { break; }
      var points: array<vec3f, 3>;
      for (var vertex = 0u; vertex < 3u; vertex++) {
        let edge = u32(TRIANGLES[tableOffset + triangle + vertex]);
        let a = EDGE_A[edge];
        let b = EDGE_B[edge];
        points[vertex] = interpolate(p[a], p[b], d[a], d[b]);
      }
      emitTriangle(points[0], points[1], points[2]);
    }
  }
}
