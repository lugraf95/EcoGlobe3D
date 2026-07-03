export const particleRenderShader = /*wgsl*/ `
struct FrameData { 
    time: f32, isCloud: f32, rotX: f32, rotY: f32,
    zoom: f32, aspectRatio: f32, sunDirX: f32, sunDirY: f32,
    sunDirZ: f32, weatherMode: f32, weatherPointCount: f32,
    gridWidth: f32, latStep: f32, lonStep: f32, pad1: f32, pad2: f32,
};

const TRAIL_LENGTH_MIN: f32 = 100.0;
const TRAIL_LENGTH_MAX: f32 = 135.0;
const SPEED_FOR_MAX_TRAIL: f32 = 0.0025;
const Z_OFFSET: f32 = 0.012;
const PARTICLE_SCALE: f32 = 0.605;
const PARTICLE_HEAD_COLOR: vec3<f32> = vec3<f32>(0.92, 0.98, 1.0);
const PARTICLE_TAIL_COLOR: vec3<f32> = vec3<f32>(0.35, 0.75, 1.0);
const MIN_TAIL_ALPHA: f32 = 0.18;
const HEAD_ALPHA_BOOST: f32 = 1.65;
const TAIL_ALPHA_MULTIPLIER: f32 = 0.9;
const PI: f32 = 3.14159;

struct Particle {
    posAndAge: vec4<f32>,
    velAndMax: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameData;
@group(0) @binding(2) var<storage, read> particles: array<Particle>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

// Baut die Positions- und Farbwerte für das Partikel-Trail-Mesh auf.
@vertex
fn vertexMain(@builtin(instance_index) instanceIdx: u32, @builtin(vertex_index) vertexIdx: u32) -> VertexOutput {
    var out: VertexOutput;
    let particle = particles[instanceIdx];
    let isTrailVertex = vertexIdx == 1u;

    let drawPosition = calculateDrawPosition(particle, isTrailVertex);
    out.position = calculateClipPosition(drawPosition);
    out.color = calculateParticleColor(particle, isTrailVertex);
    return out;
}

// Verschiebt den zweiten Vertex nach hinten, damit der Schweif entsteht.
fn calculateDrawPosition(particle: Particle, isTrailVertex: bool) -> vec3<f32> {
    var drawPosition = particle.posAndAge.xyz;

    if (isTrailVertex) {
        drawPosition -= particle.velAndMax.xyz * calculateTrailLength(particle);
    }

    return rotateParticlePosition(drawPosition);
}

// Dreht die Partikelposition mit der aktuellen Kameraposition.
fn rotateParticlePosition(position: vec3<f32>) -> vec3<f32> {
    return rotateX(rotateY(position, frame.rotY), frame.rotX);
}

// Rechnet die 3D-Position in den Clip-Space um.
fn calculateClipPosition(position: vec3<f32>) -> vec4<f32> {
    let scale = PARTICLE_SCALE * frame.zoom;
    return vec4<f32>((position.x * scale) / frame.aspectRatio, position.y * scale, (position.z * 0.1) + 0.5 - Z_OFFSET, 1.0);
}

// Berechnet die Transparenz für Kopf und Schweif des Partikels.
fn calculateParticleColor(particle: Particle, isTrailVertex: bool) -> vec4<f32> {
    let lifeRatio = particle.posAndAge.w / particle.velAndMax.w;
    let baseAlpha = sin(lifeRatio * PI);
    let trailColor = mix(PARTICLE_HEAD_COLOR, PARTICLE_TAIL_COLOR, select(0.0, 1.0, isTrailVertex));
    let headAlpha = baseAlpha * HEAD_ALPHA_BOOST;
    let tailAlpha = max(baseAlpha * TAIL_ALPHA_MULTIPLIER, MIN_TAIL_ALPHA);
    let alpha = select(headAlpha, tailAlpha, isTrailVertex);
    return vec4<f32>(trailColor, alpha);
}

// Gibt die Farbe unverändert an den Fragment-Shader weiter.
@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
    return in.color;
}

// Rotiert einen Vektor um die X-Achse.
fn rotateX(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x, pos.y * c - pos.z * s, pos.y * s + pos.z * c);
}

// Rotiert einen Vektor um die Y-Achse.
fn rotateY(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);
}

// Passt die Schweiflänge an die Bewegungsgeschwindigkeit des Partikels an.
fn calculateTrailLength(particle: Particle) -> f32 {
    let speed = length(particle.velAndMax.xyz);
    let speedFactor = clamp(speed / SPEED_FOR_MAX_TRAIL, 0.0, 1.0);
    return mix(TRAIL_LENGTH_MIN, TRAIL_LENGTH_MAX, speedFactor);
}
`;
