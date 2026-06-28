export const particleRenderShader = /*wgsl*/`
struct FrameData { 
    time: f32, isCloud: f32, rotX: f32, rotY: f32, 
    zoom: f32, aspectRatio: f32, sunDirX: f32, sunDirY: f32, 
    sunDirZ: f32, weatherMode: f32, weatherPointCount: f32, // <- HIER KORRIGIERT
    gridWidth: f32, latStep: f32, lonStep: f32, pad1: f32, pad2: f32,
};

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

@vertex
fn vertexMain(@builtin(instance_index) instanceIdx: u32, @builtin(vertex_index) vertexIdx: u32) -> VertexOutput {
    var out: VertexOutput;
    let p = particles[instanceIdx];
    
    var drawPos = p.posAndAge.xyz;
    var alphaMod = 1.0;

    // Schweif (Vertex 1) zurückversetzen
    if (vertexIdx == 1u) {
        drawPos -= p.velAndMax.xyz * 50.0; 
        alphaMod = 0.0; 
    }
    
    let rotatedPos = rotateY(rotateX(drawPos, frame.rotX), frame.rotY);
    let scale = 0.605 * frame.zoom; 
    
    out.position = vec4<f32>((rotatedPos.x * scale) / frame.aspectRatio, rotatedPos.y * scale, (rotatedPos.z * 0.1) + 0.5 - 0.012, 1.0);
    
    let lifeRatio = p.posAndAge.w / p.velAndMax.w;
    let baseAlpha = sin(lifeRatio * 3.14159); 
    
    out.color = vec4<f32>(0.8, 0.95, 1.0, baseAlpha * alphaMod * 1.5);
    return out;
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
    return in.color;
}

fn rotateX(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x, pos.y * c - pos.z * s, pos.y * s + pos.z * c);
}
fn rotateY(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);
}
`;