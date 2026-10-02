struct Background {
  values: vec4f, // viewport width, viewport height, noise strength, unused
};

@group(0) @binding(0) var<uniform> background: Background;

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-4, -4), vec2f(4, -4), vec2f(0, 4));
  return vec4f(positions[index], 0, 1);
}

fn random(coordinate: vec3f, scale: vec3f, seed: f32) -> f32 {
  return fract(sin(dot(coordinate + seed, scale)) * 43758.5453 + seed);
}

@fragment
fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let resolution = background.values.xy;
  let center = resolution * 0.5;
  let vignette = 1.0 - distance(center, position.xy) / resolution.x;
  let noise = background.values.z * (0.5 - random(position.xyz, vec3f(1), length(position.xyz)));
  let value = 0.5 * length(vec2f(position.y / resolution.y, 1.0 - abs(0.5 - position.x / resolution.x)));
  var base = vec3f(36.0, 70.0, 106.0) / 255.0;
  base += vec3f(value * value);
  return vec4f(base * vignette + vec3f(noise), 1);
}
