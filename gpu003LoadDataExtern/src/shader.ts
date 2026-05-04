export const shaderCode = `
struct FrameData { 
    time: f32,
    isCloud: f32,       
    _pad1: vec2<f32>,   
    sunDirection: vec3<f32>,
    _pad2: f32,
};

@group(0) @binding(0) var myTexture: texture_2d<f32>;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var<uniform> frame: FrameData;
@group(0) @binding(3) var nightTexture: texture_2d<f32>; 

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) normal: vec3<f32>,
};

@vertex
fn vertexMain(@location(0) pos: vec3<f32>) -> VertexOutput {
    var out: VertexOutput;
    
    let scale = 0.6 + (frame.isCloud * 0.005);
    
    // FIX: Wir ziehen bei den Wolken einen winzigen Wert vom Z-Abstand ab.
    // In WebGPU bedeutet ein kleinerer Z-Wert, dass das Objekt NÄHER an der Kamera ist.
    let zOffset = frame.isCloud*0.009;
    out.position = vec4<f32>(pos.x * scale, pos.y * scale, (pos.z * 0.1) + 0.5 - zOffset, 1.0);
    
    let norm = normalize(pos);
    out.normal = norm; 
    
    let u = 0.5 + (atan2(norm.z, norm.x) / (2.0 * 3.14159265));
    let v = 0.5 - (asin(clamp(norm.y, -0.99, 0.99)) / 3.14159265);
    out.uv = vec2<f32>(u + frame.time, v);
    
    return out;
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
    let n = normalize(in.normal);
    
    // UV-Koordinaten
    let u = 0.5 + (atan2(n.z, n.x) / (2.0 * 3.14159265));
    let v = 0.5 - (asin(clamp(n.y, -0.99, 0.99)) / 3.14159265);
    let uv = vec2<f32>(u + frame.time, v);
    
    let texColor = textureSample(myTexture, mySampler, uv);
    var baseColor = texColor.rgb;
    var alpha = 1.0;
    
    let lightIntensity = dot(n, normalize(frame.sunDirection));
    var emission = vec3<f32>(0.0, 0.0, 0.0);
    
    // --- WOLKEN-MODUS ---
    if (frame.isCloud > 0.5) {
        let brightness = max(texColor.r, max(texColor.g, texColor.b));
        if (brightness < 0.02) { discard; }
        
        alpha = brightness;
        baseColor = vec3<f32>(1.0, 1.0, 1.0);
    } 
    // --- ERD-MODUS ---
    else {
        let nightColor = textureSample(nightTexture, mySampler, uv).rgb;
        
        // NEU: DER STADT-FILTER
        // Wir messen, wie hell der Pixel in der Nacht-Textur wirklich ist
        let cityBrightness = max(nightColor.r, max(nightColor.g, nightColor.b));
        
        // Alles was dunkler ist als 10% (das blaue Meer/die grauen Kontinente), wird eiskalt auf 0.0 (Schwarz) gesetzt.
        // Nur die wirklich hellen Städte (bis 60%) dürfen leuchten.
        let cleanLights = smoothstep(0.09, 1.3, cityBrightness);
        
        let nightMix = 1.0 - smoothstep(-0.2, 0.1, lightIntensity);
        
        // Wir multiplizieren jetzt unser gefiltertes 'cleanLights' auf die Farbe
        emission = vec3<f32>(cleanLights, cleanLights, cleanLights) * nightMix * vec3<f32>(1.0, 0.9, 0.7);
    }
    
    let finalLight = max(lightIntensity, 0.02);
    let litColor = (baseColor * finalLight) + emission;
    
    return vec4<f32>(litColor, alpha);
}
`;