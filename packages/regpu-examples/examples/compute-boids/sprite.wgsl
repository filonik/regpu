struct Particle { pos: vec2f, vel: vec2f }
struct Particles { particles: array<Particle> }
@group(0) @binding(0) var<storage, read> particles: Particles;

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(4) color : vec4f,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
  let particle = particles.particles[instance];
  let vertices = array<vec2f, 3>(vec2f(-0.01, -0.02), vec2f(0.01, -0.02), vec2f(0.0, 0.02));
  let a_pos = vertices[vertex];
  let angle = -atan2(particle.vel.x, particle.vel.y);
  let pos = vec2(
    (a_pos.x * cos(angle)) - (a_pos.y * sin(angle)),
    (a_pos.x * sin(angle)) + (a_pos.y * cos(angle))
  );
  var output : VertexOutput;
  output.position = vec4(pos + particle.pos, 0.0, 1.0);
  output.color = vec4(
    1.0 - sin(angle + 1.0) - particle.vel.y,
    pos.x * 100.0 - particle.vel.y + 0.1,
    particle.vel.x + cos(angle + 0.5),
    1.0);
  return output;
}

@fragment
fn fs_main(@location(4) color : vec4f) -> @location(0) vec4f { return color; }
