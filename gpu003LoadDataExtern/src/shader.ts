export const shaderCode = `
struct FrameData { 
    time: f32,
    _pad: vec3<f32>, 
};

@group(0) @binding(0) var myTexture: texture_2d<f32>;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var<uniform> frameData: FrameData;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vertexMain(@location(0) pos: vec3<f32>) -> VertexOutput {
    var out: VertexOutput;
    
    // Wir nutzen die Z-Position, um die Wolken minimal vor die Erde zu schieben
    // Erde bei 0.5, Wolken (Sphere.001) vielleicht bei 0.49? 
    // Einfacher: Wir skalieren die Position im Shader leicht unterschiedlich.
    out.position = vec4<f32>(pos.x * 0.6, pos.y * 0.6, (pos.z * 0.1) + 0.5, 1.0);
    
    let norm = normalize(pos);
    let u = 0.5 + (atan2(norm.z, norm.x) / (2.0 * 3.14159265));
    let v = 0.5 - (asin(clamp(norm.y, -0.99, 0.99)) / 3.14159265);
    
    out.uv = vec2<f32>(u + frameData.time, v);
    return out;
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
    var color = textureSample(myTexture, mySampler, in.uv);
    
    // TRICK: Wir berechnen die Helligkeit (Luminanz)
    // Falls die Textur kein echtes Alpha hat, nehmen wir den Rot-Kanal als Alpha.
    let brightness = max(color.r, max(color.g, color.b));
    
    // Wenn der Bereich zu dunkel ist, werfen wir den Pixel einfach weg (discard).
    // Das verhindert auch, dass die Wolken den Tiefenpuffer blockieren.
    if (brightness < 0.05) { 
        discard; 
    }
    
    // Wir geben die Originalfarbe aus, nutzen aber die Helligkeit als Alpha.
    // So werden die Wolken an den Rändern sanft transparent.
    return vec4<f32>(color.rgb, brightness);
}
`;