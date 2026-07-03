export const particleComputeShader = /*wgsl*/ `
// Enthält die globalen Uniform-Variablen wie Kameraparameter, Zeit und Raster-Metadaten zur Steuerung der Simulation.
struct FrameData { 
    time: f32, isCloud: f32, rotX: f32, rotY: f32,
    zoom: f32, aspectRatio: f32, sunDirX: f32, sunDirY: f32,
    sunDirZ: f32, weatherMode: f32, weatherPointCount: f32,
    gridWidth: f32, latStep: f32, lonStep: f32, pad1: f32, pad2: f32,
};

const SPAWN_LIFETIME_MIN: f32 = 60.0;
const SPAWN_LIFETIME_RANGE: f32 = 60.0;
const PARTICLE_ADVECT_SPEED: f32 = 0.0003;
const MAX_LATITUDE: f32 = 89.9;
const MIN_LATITUDE: f32 = -89.9;
const MIN_COSINE: f32 = 0.1;
const FULL_CIRCLE_DEGREES: f32 = 360.0;
const HALF_CIRCLE_DEGREES: f32 = 180.0;
const TOP_LATITUDE_DEGREES: f32 = 90.0;
const PI: f32 = 3.14159265;

// Speichert den Zustand eines Partikels, komprimiert in zwei Vektoren für Position, Alter, Geschwindigkeit und maximale Lebensdauer.
struct Particle {
    posAndAge: vec4<f32>,
    velAndMax: vec4<f32>,
};

// Repräsentiert die abgerufenen Wetterdaten für einen geografischen Rasterpunkt, um daraus das Windfeld zu berechnen.
struct WeatherPoint {
    lat: f32, lon: f32, temp: f32, windU: f32,
    windV: f32, pad1: f32, pad2: f32, pad3: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameData;
@group(0) @binding(1) var<storage, read> weather: array<WeatherPoint>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;

// Steuert den Lebenszyklus jedes Partikels in der Workgroup, indem das Alter erhöht und entweder eine Bewegung oder ein Respawn ausgelöst wird.
@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let particleIndex = globalId.x;
    
    if (particleIndex >= arrayLength(&particles)) { return; }

    var particle = particles[particleIndex];
    particle.posAndAge.w += 1.0;

    if (shouldRespawnParticle(particle)) {
        particle = respawnParticle(particleIndex);
    } else {
        particle = advanceParticle(particle);
    }

    particles[particleIndex] = particle;
}

// Prüft, ob ein Partikel seine maximale Lebensdauer überschritten hat oder auf die unsichtbare Rückseite der Kugel gewandert ist.
fn shouldRespawnParticle(particle: Particle) -> bool {
    return particle.posAndAge.w > particle.velAndMax.w || isBackface(particle.posAndAge.xyz);
}

// Generiert ein neues Partikel mit zufälliger, der Kamera zugewandter Startposition auf der Kugeloberfläche und setzt dessen Alter zurück.
fn respawnParticle(seed: u32) -> Particle {
    var particle: Particle;
    particle.posAndAge.w = 0.0;
    particle.velAndMax.w = SPAWN_LIFETIME_MIN + random(seed + u32(frame.time * 1000.0)) * SPAWN_LIFETIME_RANGE;
    particle.velAndMax.x = 0.0; particle.velAndMax.y = 0.0; particle.velAndMax.z = 0.0;
    
    let randomU = random(seed * 13u + u32(frame.time * 100.0));
    let randomV = random(seed * 71u + u32(frame.time * 200.0));
    let theta = randomU * 2.0 * PI;
    let phi = acos(2.0 * randomV - 1.0);
    
    var localPosition = vec3<f32>(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
    if (localPosition.z < 0.0) { localPosition.z = -localPosition.z; }
    
    particle.posAndAge = vec4<f32>(rotateY(rotateX(localPosition, -frame.rotX), -frame.rotY), 0.0);
    return particle;
}

// Aktualisiert die 3D-Position und den Geschwindigkeitsvektor eines Partikels basierend auf dem anliegenden Windfeld.
fn advanceParticle(particle: Particle) -> Particle {
    var updatedParticle = particle;
    let currentPosition = particle.posAndAge.xyz;
    let nextPosition = advectParticle(currentPosition);

    updatedParticle.posAndAge = vec4<f32>(nextPosition, particle.posAndAge.w);
    updatedParticle.velAndMax = vec4<f32>(nextPosition - currentPosition, particle.velAndMax.w);
    return updatedParticle;
}

// Transformiert die 3D-Kugelkoordinaten in geografische Grade, verschiebt sie anhand der Windvektoren und konvertiert sie zurück in den 3D-Raum.
fn advectParticle(position: vec3<f32>) -> vec3<f32> {
    let latitude = degrees(asin(position.y));
    let longitude = degrees(atan2(-position.z, position.x));
    
    let wind = getWindAt(latitude, longitude);
    
    let nextLatitude = clamp(latitude + wind.y * PARTICLE_ADVECT_SPEED, MIN_LATITUDE, MAX_LATITUDE);
    
    let cosineLatitude = max(cos(radians(latitude)), MIN_COSINE);
    var nextLongitude = longitude + (wind.x * PARTICLE_ADVECT_SPEED) / cosineLatitude;
    
    nextLongitude = wrapLongitude(nextLongitude);
    
    let radiansLatitude = radians(nextLatitude);
    let radiansLongitude = radians(nextLongitude);
    
    return vec3<f32>(
        cos(radiansLongitude) * cos(radiansLatitude),
        sin(radiansLatitude),
        -sin(radiansLongitude) * cos(radiansLatitude)
    );
}

// Ermittelt durch Berücksichtigung der aktuellen Kamerarotation, ob sich eine 3D-Position auf der abgewandten Seite der Kugel befindet.
fn isBackface(position: vec3<f32>) -> bool {
    let rotatedPosition = rotateX(rotateY(position, frame.rotY), frame.rotX);
    return rotatedPosition.z < -0.1;
}

// Korrigiert den Längengrad nach einer Verschiebung zyklisch, damit er stets im gültigen Bereich von -180 bis 180 Grad verbleibt.
fn wrapLongitude(longitude: f32) -> f32 {
    var wrappedLongitude = longitude;

    if (wrappedLongitude > 180.0) { wrappedLongitude -= FULL_CIRCLE_DEGREES; }
    if (wrappedLongitude < -180.0) { wrappedLongitude += FULL_CIRCLE_DEGREES; }

    return wrappedLongitude;
}

// Berechnet den lokalen Windvektor an einer beliebigen geografischen Position durch bilineare Interpolation der vier nächstgelegenen Rasterpunkte.
fn getWindAt(latitude: f32, longitude: f32) -> vec2<f32> {
    let lastIndex = arrayLength(&weather) - 1u;
    if (lastIndex <= 0u) { return vec2<f32>(0.0, 0.0); }

    let latitudeIndex = (TOP_LATITUDE_DEGREES - latitude) / frame.latStep;
    let longitudeIndex = (longitude + 180.0) / frame.lonStep;

    let rowCount = u32(HALF_CIRCLE_DEGREES / frame.latStep);
    let columnCount = u32(frame.gridWidth);

    let row0 = clamp(u32(floor(latitudeIndex)), 0u, rowCount);
    let row1 = clamp(row0 + 1u, 0u, rowCount);
    
    let column0 = u32(floor(longitudeIndex)) % columnCount;
    let column1 = (column0 + 1u) % columnCount;

    let index00 = min(row0 * columnCount + column0, lastIndex);
    let index10 = min(row1 * columnCount + column0, lastIndex);
    let index01 = min(row0 * columnCount + column1, lastIndex);
    let index11 = min(row1 * columnCount + column1, lastIndex);

    let wind00 = vec2<f32>(weather[index00].windU, weather[index00].windV);
    let wind10 = vec2<f32>(weather[index10].windU, weather[index10].windV);
    let wind01 = vec2<f32>(weather[index01].windU, weather[index01].windV);
    let wind11 = vec2<f32>(weather[index11].windU, weather[index11].windV);

    let latitudeFraction = fract(latitudeIndex);
    let longitudeFraction = fract(longitudeIndex);

    let topWind = mix(wind00, wind01, longitudeFraction);
    let bottomWind = mix(wind10, wind11, longitudeFraction);
    return mix(topWind, bottomWind, latitudeFraction);
}

// Rotiert einen 3D-Vektor um den angegebenen Winkel um die X-Achse.
fn rotateX(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x, pos.y * c - pos.z * s, pos.y * s + pos.z * c);
}

// Rotiert einen 3D-Vektor um den angegebenen Winkel um die Y-Achse.
fn rotateY(pos: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);
}

// Erzeugt basierend auf einem veränderlichen Seed einen deterministischen, gleichmäßig verteilten Pseudo-Zufallswert zwischen 0,0 und 1,0.
fn random(seed: u32) -> f32 {
    var state = seed * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return f32((word >> 22u) ^ word) / 4294967295.0;
}
`;
