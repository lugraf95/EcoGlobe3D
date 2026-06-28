export const particleComputeShader = /*wgsl*/`
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

struct WeatherPoint {
    lat: f32, lon: f32, temp: f32, windU: f32, 
    windV: f32, pad1: f32, pad2: f32, pad3: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameData;
@group(0) @binding(1) var<storage, read> weather: array<WeatherPoint>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    
    if (index >= arrayLength(&particles)) { return; }

    var p = particles[index];
    p.posAndAge.w += 1.0;

    if (p.posAndAge.w > p.velAndMax.w || isBackface(p.posAndAge.xyz)) {
        p = spawnOnFrontFace(index);
    } else {
        let oldPos = p.posAndAge.xyz;
        let newPos = advectParticle(oldPos);
        p.posAndAge = vec4<f32>(newPos, p.posAndAge.w);
        p.velAndMax = vec4<f32>(newPos - oldPos, p.velAndMax.w);
    }

    particles[index] = p;
}

fn isBackface(pos: vec3<f32>) -> bool {
    let rotatedPos = rotateY(rotateX(pos, frame.rotX), frame.rotY);
    return rotatedPos.z < -0.1; 
}

fn spawnOnFrontFace(seed: u32) -> Particle {
    var p: Particle;
    p.posAndAge.w = 0.0; 
    p.velAndMax.w = 60.0 + random(seed + u32(frame.time * 1000.0)) * 60.0; 
    p.velAndMax.x = 0.0; p.velAndMax.y = 0.0; p.velAndMax.z = 0.0;
    
    let u = random(seed * 13u + u32(frame.time * 100.0));
    let v = random(seed * 71u + u32(frame.time * 200.0));
    let theta = u * 2.0 * 3.14159265;
    let phi = acos(2.0 * v - 1.0);
    
    var localPos = vec3<f32>(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
    if (localPos.z < 0.0) { localPos.z = -localPos.z; } 
    
    p.posAndAge = vec4<f32>(rotateX(rotateY(localPos, -frame.rotY), -frame.rotX), 0.0);
    return p;
}

fn advectParticle(pos: vec3<f32>) -> vec3<f32> {
    let lat = degrees(asin(pos.y));
    let lon = degrees(atan2(-pos.z, pos.x));
    
    let wind = getWindAt(lat, lon);
    
    let moveSpeed = 0.0003; 
    let newLat = clamp(lat + wind.y * moveSpeed, -89.9, 89.9); 
    
    let cosLat = max(cos(radians(lat)), 0.1);
    var newLon = lon + (wind.x * moveSpeed) / cosLat; 
    
    if (newLon > 180.0) { newLon -= 360.0; }
    if (newLon < -180.0) { newLon += 360.0; }
    
    let radLat = radians(newLat);
    let radLon = radians(newLon);
    
    return vec3<f32>(
        cos(radLon) * cos(radLat),
        sin(radLat),
        -sin(radLon) * cos(radLat)
    );
}

// Bilineare Interpolation der Winddaten basierend auf dynamischem Raster
fn getWindAt(lat: f32, lon: f32) -> vec2<f32> {
    let maxIdx = arrayLength(&weather) - 1u;
    if (maxIdx <= 0u) { return vec2<f32>(0.0, 0.0); }

    let latIdxF = (90.0 - lat) / frame.latStep;
    let lonIdxF = (lon + 180.0) / frame.lonStep;

    let maxRows = u32(180.0 / frame.latStep);
    let gridCols = u32(frame.gridWidth);

    let i0 = clamp(u32(floor(latIdxF)), 0u, maxRows);
    let i1 = clamp(i0 + 1u, 0u, maxRows);
    
    let j0 = u32(floor(lonIdxF)) % gridCols;
    let j1 = (j0 + 1u) % gridCols; 

    let idx00 = min(i0 * gridCols + j0, maxIdx);
    let idx10 = min(i1 * gridCols + j0, maxIdx);
    let idx01 = min(i0 * gridCols + j1, maxIdx);
    let idx11 = min(i1 * gridCols + j1, maxIdx);

    let w00 = vec2<f32>(weather[idx00].windU, weather[idx00].windV);
    let w10 = vec2<f32>(weather[idx10].windU, weather[idx10].windV);
    let w01 = vec2<f32>(weather[idx01].windU, weather[idx01].windV);
    let w11 = vec2<f32>(weather[idx11].windU, weather[idx11].windV);

    let fracLat = fract(latIdxF);
    let fracLon = fract(lonIdxF);

    let w0 = mix(w00, w01, fracLon);
    let w1 = mix(w10, w11, fracLon);
    return mix(w0, w1, fracLat);
}

fn rotateX(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x, pos.y * c - pos.z * s, pos.y * s + pos.z * c);
}

fn rotateY(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);
}

fn random(seed: u32) -> f32 {
    var state = seed * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return f32((word >> 22u) ^ word) / 4294967295.0;
}
`;