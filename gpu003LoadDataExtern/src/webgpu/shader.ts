export const shaderCode = `//wgsl
struct FrameData { 
    time: f32,          
    isCloud: f32,       
    rotX: f32,          
    rotY: f32,          
    zoom: f32,          
    aspectRatio: f32,
    sunDirX: f32,
    sunDirY: f32,
    sunDirZ: f32,
    pad1: f32,
    pad2: f32,
    pad3: f32,
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

fn rotateY(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);
}
fn rotateX(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x, pos.y * c - pos.z * s, pos.y * s + pos.z * c);
}

@vertex
fn vertexMain(@location(0) pos: vec3<f32>) -> VertexOutput {
    var out: VertexOutput;
    
    let pure_pos = normalize(pos);
    out.uv = vec2<f32>(
        0.5 + (atan2(pure_pos.z, pure_pos.x) / (2.0 * 3.14159265)),
        0.5 - (asin(clamp(pure_pos.y, -0.99, 0.99)) / 3.14159265)
    );

    var rotated_pos = rotateX(pure_pos, frame.rotX);
    rotated_pos = rotateY(rotated_pos, frame.rotY);
    
    let scale = (0.6 + (frame.isCloud * 0.005)) * frame.zoom;
    let zOffset = frame.isCloud * 0.009;
    out.position = vec4<f32>((rotated_pos.x * scale) / frame.aspectRatio, rotated_pos.y * scale, (rotated_pos.z * 0.1) + 0.5 - zOffset, 1.0);
    out.normal = rotated_pos; 
    
    return out;
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
    let n = normalize(in.normal);
    
    let texColor = textureSample(myTexture, mySampler, in.uv);
    var baseColor = texColor.rgb;
    var alpha = 1.0; 
    
    let sunVec = vec3<f32>(frame.sunDirX, frame.sunDirY, frame.sunDirZ);
    let lightIntensity = dot(n, normalize(sunVec));
    var emission = vec3<f32>(0.0, 0.0, 0.0); 
    
    if (frame.isCloud > 0.5) {
        let brightness = max(texColor.r, max(texColor.g, texColor.b));
        if (brightness < 0.02) { discard; }
        alpha = brightness; 
        baseColor = vec3<f32>(1.0, 1.0, 1.0); 
    } else {
        let nightColor = textureSample(nightTexture, mySampler, in.uv).rgb;
        
        let cityBrightness = max(nightColor.r, max(nightColor.g, nightColor.b));
        let cleanLights = smoothstep(0.09, 1.3, cityBrightness);
        let nightMix = 1.0 - smoothstep(-0.2, 0.1, lightIntensity);
        emission = vec3<f32>(cleanLights, cleanLights, cleanLights) * nightMix * vec3<f32>(1.0, 0.9, 0.7);
    }
    
    let finalLight = max(lightIntensity, 0.02);
    let litColor = (baseColor * finalLight) + emission;
    
    return vec4<f32>(litColor, alpha);
}
`;