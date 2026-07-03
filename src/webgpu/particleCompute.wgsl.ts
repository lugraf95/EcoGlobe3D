export const particleComputeShader = /*wgsl*/ `

// STRUCT: FrameData
// Enthält globale Parameter, die für jeden Frame aktualisiert werden.
// Steuert die Zeit, die Kameraausrichtung (rotX, rotY, zoom), sowie 
// Raster- und Wetterinformationen für die Windberechnung.
struct FrameData { 
    time: f32, isCloud: f32, rotX: f32, rotY: f32,
    zoom: f32, aspectRatio: f32, sunDirX: f32, sunDirY: f32,
    sunDirZ: f32, weatherMode: f32, weatherPointCount: f32,
    gridWidth: f32, latStep: f32, lonStep: f32, pad1: f32, pad2: f32,
};

// GLOBALE KONSTANTEN
// Definieren das Verhalten der Partikel-Lebenszyklen, die Bewegungsgeschwindigkeit
// und mathematische/geografische Grenzen für die sphärischen Koordinaten.
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

// STRUCT: Particle
// Repräsentiert ein einzelnes Partikel im Compute-Shader.
// posAndAge: xyz = aktuelle 3D-Position, w = aktuelles Alter.
// velAndMax: xyz = aktueller Geschwindigkeitsvektor, w = maximale Lebensdauer.
struct Particle {
    posAndAge: vec4<f32>,
    velAndMax: vec4<f32>,
};

// STRUCT: WeatherPoint
// Repräsentiert einen Datenpunkt auf dem globalen Wetter-Gitter.
// Beinhaltet geografische Koordinaten, Temperatur sowie die Windvektoren (U und V).
struct WeatherPoint {
    lat: f32, lon: f32, temp: f32, windU: f32,
    windV: f32, pad1: f32, pad2: f32, pad3: f32,
};

// GLOBALE VARIABLEN (Bindings)
// frame: Lesezugriff auf Frame-abhängige Uniforms.
// weather: Lesezugriff auf das Array mit den Wetter-Gitterdaten.
// particles: Lese- und Schreibzugriff auf das Array aller Partikel, um diese zu aktualisieren.
@group(0) @binding(0) var<uniform> frame: FrameData;
@group(0) @binding(1) var<storage, read> weather: array<WeatherPoint>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;

// Aktualisiert ein einzelnes Partikel und entscheidet über Respawn oder Bewegung.
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

// Prüft, ob ein Partikel auf der Rückseite der Kugel liegt oder zu alt ist.
fn shouldRespawnParticle(particle: Particle) -> bool {
    return particle.posAndAge.w > particle.velAndMax.w || isBackface(particle.posAndAge.xyz);
}

// Setzt ein Partikel auf die Vorderseite der Kugel zurück.
fn respawnParticle(seed: u32) -> Particle {
    var particle: Particle;
    
    // 1. Setze das Alter zurück und berechne eine neue zufällige Lebensdauer.
    particle.posAndAge.w = 0.0;
    particle.velAndMax.w = SPAWN_LIFETIME_MIN + random(seed + u32(frame.time * 1000.0)) * SPAWN_LIFETIME_RANGE;
    particle.velAndMax.x = 0.0; particle.velAndMax.y = 0.0; particle.velAndMax.z = 0.0;
    
    // 2. Erzeuge zufällige sphärische Koordinaten (theta für Längengrad, phi für Breitengrad),
    // um eine gleichmäßige Verteilung auf einer Kugeloberfläche zu erreichen.
    let randomU = random(seed * 13u + u32(frame.time * 100.0));
    let randomV = random(seed * 71u + u32(frame.time * 200.0));
    let theta = randomU * 2.0 * PI;
    let phi = acos(2.0 * randomV - 1.0);
    
    // 3. Wandle die sphärischen Koordinaten in 3D-kartesische Koordinaten (x, y, z) um.
    var localPosition = vec3<f32>(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
    
    // 4. Erzwinge, dass das Partikel auf der uns zugewandten Seite (Vorderseite) spawnt.
    if (localPosition.z < 0.0) { localPosition.z = -localPosition.z; }
    
    // 5. Rotiere die Spawn-Position entsprechend der aktuellen Kameraposition, 
    // damit die Vorderseite relativ zum Betrachter bleibt.
    particle.posAndAge = vec4<f32>(rotateY(rotateX(localPosition, -frame.rotX), -frame.rotY), 0.0);
    return particle;
}

// Bewegt ein Partikel entlang des lokalen Windfelds.
fn advanceParticle(particle: Particle) -> Particle {
    var updatedParticle = particle;
    let currentPosition = particle.posAndAge.xyz;
    let nextPosition = advectParticle(currentPosition);

    updatedParticle.posAndAge = vec4<f32>(nextPosition, particle.posAndAge.w);
    updatedParticle.velAndMax = vec4<f32>(nextPosition - currentPosition, particle.velAndMax.w);
    return updatedParticle;
}

// Wandelt eine Kugelposition in Breite und Länge um und bewegt sie mit Wind.
fn advectParticle(position: vec3<f32>) -> vec3<f32> {
    // 1. Wandle die kartesische 3D-Position in geografische Koordinaten (Breiten- und Längengrad in Grad) um.
    let latitude = degrees(asin(position.y));
    let longitude = degrees(atan2(-position.z, position.x));
    
    // 2. Hole den Windvektor (U = Ost-West, V = Nord-Süd) für diese Position aus den Wetterdaten.
    let wind = getWindAt(latitude, longitude);
    
    // 3. Berechne den neuen Breitengrad basierend auf dem V-Wind (Nord/Süd) und limitiere ihn, 
    // um Pol-Singularitäten (exakt 90 Grad) zu vermeiden.
    let nextLatitude = clamp(latitude + wind.y * PARTICLE_ADVECT_SPEED, MIN_LATITUDE, MAX_LATITUDE);
    
    // 4. Skaliere den U-Wind (Ost/West) basierend auf dem Breitengrad. Je näher an den Polen, 
    // desto enger liegen die Längengrade zusammen (Kosinus-Korrektur).
    let cosineLatitude = max(cos(radians(latitude)), MIN_COSINE);
    var nextLongitude = longitude + (wind.x * PARTICLE_ADVECT_SPEED) / cosineLatitude;
    
    // 5. Stelle sicher, dass der Längengrad im Bereich von -180 bis 180 Grad bleibt (Wrap-Around).
    nextLongitude = wrapLongitude(nextLongitude);
    
    // 6. Wandle die neuen geografischen Koordinaten zurück in eine kartesische 3D-Position auf der Einheitskugel.
    let radiansLatitude = radians(nextLatitude);
    let radiansLongitude = radians(nextLongitude);
    
    return vec3<f32>(
        cos(radiansLongitude) * cos(radiansLatitude),
        sin(radiansLatitude),
        -sin(radiansLongitude) * cos(radiansLatitude)
    );
}

// Prüft, ob ein Punkt auf der Rückseite der Kugel liegt.
fn isBackface(position: vec3<f32>) -> bool {
    let rotatedPosition = rotateX(rotateY(position, frame.rotY), frame.rotX);
    return rotatedPosition.z < -0.1;
}

// Wickelt die Länge auf den gültigen Bereich von -180 bis 180 Grad zurück.
fn wrapLongitude(longitude: f32) -> f32 {
    var wrappedLongitude = longitude;

    if (wrappedLongitude > 180.0) { wrappedLongitude -= FULL_CIRCLE_DEGREES; }
    if (wrappedLongitude < -180.0) { wrappedLongitude += FULL_CIRCLE_DEGREES; }

    return wrappedLongitude;
}

// Berechnet die Windgeschwindigkeit für einen Breiten- und Längengrad per bilinearer Interpolation.
fn getWindAt(latitude: f32, longitude: f32) -> vec2<f32> {
    let lastIndex = arrayLength(&weather) - 1u;
    if (lastIndex <= 0u) { return vec2<f32>(0.0, 0.0); }

    // 1. Rechne die Breiten- und Längengrade in Float-Indizes für das Raster um.
    let latitudeIndex = (TOP_LATITUDE_DEGREES - latitude) / frame.latStep;
    let longitudeIndex = (longitude + 180.0) / frame.lonStep;

    let rowCount = u32(HALF_CIRCLE_DEGREES / frame.latStep);
    let columnCount = u32(frame.gridWidth);

    // 2. Ermittle die vier benachbarten Rasterpunkte (oben/unten, links/rechts), 
    // die das Partikel einschließen.
    let row0 = clamp(u32(floor(latitudeIndex)), 0u, rowCount);
    let row1 = clamp(row0 + 1u, 0u, rowCount);
    
    let column0 = u32(floor(longitudeIndex)) % columnCount;
    let column1 = (column0 + 1u) % columnCount;

    // 3. Berechne die finalen flachen Array-Indizes für diese vier Ecken.
    let index00 = min(row0 * columnCount + column0, lastIndex);
    let index10 = min(row1 * columnCount + column0, lastIndex);
    let index01 = min(row0 * columnCount + column1, lastIndex);
    let index11 = min(row1 * columnCount + column1, lastIndex);

    // 4. Lade die Windvektoren (U, V) für alle vier Eckpunkte.
    let wind00 = vec2<f32>(weather[index00].windU, weather[index00].windV); // Oben links
    let wind10 = vec2<f32>(weather[index10].windU, weather[index10].windV); // Unten links
    let wind01 = vec2<f32>(weather[index01].windU, weather[index01].windV); // Oben rechts
    let wind11 = vec2<f32>(weather[index11].windU, weather[index11].windV); // Unten rechts

    // 5. Bestimme den relativen Abstand (0.0 bis 1.0) des Partikels zu den jeweiligen Gitterlinien.
    let latitudeFraction = fract(latitudeIndex);
    let longitudeFraction = fract(longitudeIndex);

    // 6. Führe eine bilineare Interpolation durch:
    // Zuerst horizontal zwischen links und rechts (für die obere und untere Reihe separat).
    let topWind = mix(wind00, wind01, longitudeFraction);
    let bottomWind = mix(wind10, wind11, longitudeFraction);
    // Danach vertikal zwischen den beiden berechneten horizontalen Werten.
    return mix(topWind, bottomWind, latitudeFraction);
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

// Erzeugt aus einem Seed einen gleichmäßig verteilten Zufallswert im Bereich 0.0 bis 1.0.
fn random(seed: u32) -> f32 {
    // Verwendet einfache Bit-Shift-Operationen und Multiplikationen (Hashing), 
    // um aus einem Basis-Seed schnell pseudo-zufällige Float-Werte auf der GPU zu generieren.
    var state = seed * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return f32((word >> 22u) ^ word) / 4294967295.0;
}
`;