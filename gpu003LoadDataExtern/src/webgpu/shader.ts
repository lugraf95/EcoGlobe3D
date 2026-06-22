export const shaderCode = /*wgsl*/`
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
    weatherMode: f32,
    weatherPointCount: f32,
    pad: f32,
};

@group(0) @binding(0) var myTexture: texture_2d<f32>;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var<uniform> frame: FrameData;
@group(0) @binding(3) var nightTexture: texture_2d<f32>;

struct WeatherPoint {
    latitude: f32,
    longitude: f32,
    temperature: f32,
    windU: f32,
    windV: f32,
    pad1: f32,
    pad2: f32,
    pad3: f32,
};

struct WeatherData {
    values: array<WeatherPoint>,
};

@group(0) @binding(4) var<storage, read> weather: WeatherData;

struct VertexInput {
    @location(0) position: vec4<f32>,
    @location(1) normal: vec4<f32>,
    @location(2) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) normal: vec3<f32>,
};

@vertex
fn vertexMain(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.uv = in.uv; 
    let rotatedPosition = applyRotation(in.position.xyz);
    out.position = calculateScreenPosition(rotatedPosition);
    out.normal = applyRotation(in.normal.xyz);
    return out;
}

fn applyRotation(pos: vec3<f32>) -> vec3<f32> {
    var rotated = rotateX(pos, frame.rotX);
    return rotateY(rotated, frame.rotY);
}

fn rotateX(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x, pos.y * c - pos.z * s, pos.y * s + pos.z * c);
}

fn rotateY(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);
}

fn calculateScreenPosition(pos: vec3<f32>) -> vec4<f32> {
    let scale = (0.6 + (frame.isCloud * 0.005)) * frame.zoom;
    let zOffset = frame.isCloud * 0.009;
    return vec4<f32>((pos.x * scale) / frame.aspectRatio, pos.y * scale, (pos.z * 0.1) + 0.5 - zOffset, 1.0);
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
    let normal = normalize(in.normal);
    let lightIntensity = calculateLightIntensity(normal);
    
    if (frame.isCloud > 0.5) {
        return renderCloudLayer(in.uv, lightIntensity);
    }
    return renderEarthLayer(in.uv, lightIntensity);
}

fn calculateLightIntensity(normal: vec3<f32>) -> f32 {
    let sunVec = normalize(vec3<f32>(frame.sunDirX, frame.sunDirY, frame.sunDirZ));
    return dot(normal, sunVec);
}

fn renderCloudLayer(uv: vec2<f32>, lightIntensity: f32) -> vec4<f32> {
    let texColor = textureSample(myTexture, mySampler, uv);
    let brightness = max(texColor.r, max(texColor.g, texColor.b));
    if (brightness < 0.02) { discard; }
    
    let alpha = brightness * 0.8; 
    let finalLight = max(lightIntensity, 0.02);
    return vec4<f32>(vec3<f32>(1.0, 1.0, 1.0) * finalLight, alpha);
}

fn renderEarthLayer(uv: vec2<f32>, lightIntensity: f32) -> vec4<f32> {
    let baseTextureColor = textureSample(myTexture, mySampler, uv).rgb;
    var finalSurfaceColor = baseTextureColor;
    var lightEmission = vec3<f32>(0.0, 0.0, 0.0);
    
    // Wind (Mode 2) wird hier nicht mehr behandelt, nur noch Temp (Mode 1)
    if (frame.weatherMode == 1.0 && frame.weatherPointCount > 0.0) {
        finalSurfaceColor = applyHeatmap(uv);
    } else {
        lightEmission = calculateNightLights(uv, lightIntensity);
    }
    
    let finalLight = max(lightIntensity, 0.02);
    let litColor = (finalSurfaceColor * finalLight) + lightEmission;
    return vec4<f32>(litColor, 1.0);
}

fn calculateNightLights(uv: vec2<f32>, lightIntensity: f32) -> vec3<f32> {
    let nightColor = textureSample(nightTexture, mySampler, uv).rgb;
    let cityBrightness = max(nightColor.r, max(nightColor.g, nightColor.b));
    let cleanLights = smoothstep(0.09, 1.3, cityBrightness);
    let nightMix = 1.0 - smoothstep(-0.2, 0.1, lightIntensity);
    return vec3<f32>(cleanLights, cleanLights, cleanLights) * nightMix * vec3<f32>(1.0, 0.9, 0.7);
}

fn applyHeatmap(uv: vec2<f32>) -> vec3<f32> {
    let pointCount = min(u32(frame.weatherPointCount), arrayLength(&weather.values));
    let lat = (0.5 - uv.y) * 180.0;
    let lon = (uv.x * 360.0) - 180.0;

    var weightedTemp = 0.0;
    var tempWeight = 0.0;

    for (var i: u32 = 0u; i < pointCount; i = i + 1u) {
        let point = weather.values[i];
        let dLat = abs(lat - point.latitude);
        var dLon = abs(lon - point.longitude);
        if (dLon > 180.0) { dLon = 360.0 - dLon; }
        
        let dist = length(vec2<f32>(dLat, dLon));
        let influence = exp(-dist * 0.15); 
        
        weightedTemp = weightedTemp + (point.temperature * influence);
        tempWeight = tempWeight + influence;
    }

    let avgTemp = select(15.0, weightedTemp / tempWeight, tempWeight > 0.00001);
    
    if (avgTemp <= 0.0) { return vec3<f32>(0.1, 0.3, 1.0); }
    if (avgTemp <= 15.0) { return mix(vec3<f32>(0.1, 0.3, 1.0), vec3<f32>(0.1, 0.8, 0.2), avgTemp / 15.0); }
    if (avgTemp <= 25.0) { return mix(vec3<f32>(0.1, 0.8, 0.2), vec3<f32>(1.0, 0.9, 0.1), (avgTemp - 15.0) / 10.0); }
    if (avgTemp <= 30.0) { return mix(vec3<f32>(1.0, 0.9, 0.1), vec3<f32>(1.0, 0.2, 0.1), (avgTemp - 25.0) / 5.0); }
    return vec3<f32>(1.0, 0.1, 0.05);
}
`;