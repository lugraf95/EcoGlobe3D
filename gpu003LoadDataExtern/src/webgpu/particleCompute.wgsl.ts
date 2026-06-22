export const particleComputeShader = /*wgsl*/`
struct FrameData { 
    time: f32, isCloud: f32, rotX: f32, rotY: f32, 
    zoom: f32, aspectRatio: f32, sunDirX: f32, sunDirY: f32, 
    sunDirZ: f32, weatherMode: f32, particleCount: f32, pad: f32,
};

struct Particle {
    posAndAge: vec4<f32>, // xyz = Position, w = Current Age
    velAndMax: vec4<f32>, // xyz = Letzte Bewegung, w = Max Age
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
    if (index >= u32(frame.particleCount)) { return; }

    var p = particles[index];
    p.posAndAge.w += 1.0; // Alter erhoehen

    // Wenn zu alt oder auf der Rueckseite: NEU SPAWNEN
    if (p.posAndAge.w > p.velAndMax.w || isBackface(p.posAndAge.xyz)) {
        p = spawnOnFrontFace(index);
    } else {
        // Sonst: WIND-PHYSIK ANWENDEN
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
    p.posAndAge.w = 0.0; // Start Alter
    p.velAndMax.w = 60.0 + random(seed + u32(frame.time * 1000.0)) * 60.0; // Max Alter
    p.velAndMax.x = 0.0; p.velAndMax.y = 0.0; p.velAndMax.z = 0.0;
    
    let u = random(seed * 13u + u32(frame.time * 100.0));
    let v = random(seed * 71u + u32(frame.time * 200.0));
    let theta = u * 2.0 * 3.14159265;
    let phi = acos(2.0 * v - 1.0);
    
    var localPos = vec3<f32>(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
    if (localPos.z < 0.0) { localPos.z = -localPos.z; } // Zwinge auf Vorderseite
    
    // MATHEMATIK FIX: Inverse Rotation anwenden! Zuerst Y zurückdrehen, dann X!
    p.posAndAge = vec4<f32>(rotateX(rotateY(localPos, -frame.rotY), -frame.rotX), 0.0);
    return p;
}

fn advectParticle(pos: vec3<f32>) -> vec3<f32> {
    // MATHEMATIK FIX: Korrekte Extraktion von Lat/Lon aus der 3D-Kugel
    let lat = degrees(asin(pos.y));
    let lon = degrees(atan2(-pos.z, pos.x));
    
    let wind = getWindAt(lat, lon);
    
    let moveSpeed = 0.0003; 
    let newLat = clamp(lat + wind.y * moveSpeed, -89.9, 89.9); 
    
    // Verhindert, dass Partikel am Pol extrem beschleunigen
    let cosLat = max(cos(radians(lat)), 0.1);
    var newLon = lon + (wind.x * moveSpeed) / cosLat; 
    
    // Wrap Longitude (Wenn ein Partikel die Datumsgrenze ueberschreitet)
    if (newLon > 180.0) { newLon -= 360.0; }
    if (newLon < -180.0) { newLon += 360.0; }
    
    let radLat = radians(newLat);
    let radLon = radians(newLon);
    
    // MATHEMATIK FIX: Korrekte Projektion von Lat/Lon zurück in den 3D-Raum
    return vec3<f32>(
        cos(radLon) * cos(radLat),
        sin(radLat),
        -sin(radLon) * cos(radLat)
    );
}

fn getWindAt(lat: f32, lon: f32) -> vec2<f32> {
    let latIdx = clamp(u32((90.0 - lat) / 2.0), 0u, 90u);
    let lonIdx = clamp(u32((lon + 180.0) / 2.0), 0u, 179u);
    let idx = latIdx * 180u + lonIdx;
    
    let w = weather[idx];
    return vec2<f32>(w.windU, w.windV);
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