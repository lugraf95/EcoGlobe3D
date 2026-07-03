export const particleRenderShader = /*wgsl*/`

// STRUCT: FrameData
// Beinhaltet globale Parameter, die für jeden Frame von der CPU an die GPU übergeben werden.
// Dient zur Steuerung von Zeit, Kamera (Zoom, Rotation, Seitenverhältnis), Sonneneinstrahlung 
// sowie Wetter- und Gitter-Konfigurationen.
struct FrameData { 
    time: f32, isCloud: f32, rotX: f32, rotY: f32,
    zoom: f32, aspectRatio: f32, sunDirX: f32, sunDirY: f32,
    sunDirZ: f32, weatherMode: f32, weatherPointCount: f32,
    gridWidth: f32, latStep: f32, lonStep: f32, pad1: f32, pad2: f32,
};

// GLOBALE KONSTANTEN
// Definieren das grundlegende Aussehen und Verhalten der Partikel wie Farben, Skalierung, 
// Transparenz-Multiplikatoren und die Grenzen der Schweiflänge.
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

// STRUCT: Particle
// Repräsentiert die physikalischen und zeitlichen Daten eines einzelnen Partikels.
// posAndAge: xyz = 3D-Position, w = aktuelles Alter des Partikels.
// velAndMax: xyz = Bewegungsrichtung/-geschwindigkeit, w = maximales Lebensalter.
struct Particle {
    posAndAge: vec4<f32>,
    velAndMax: vec4<f32>,
};

// GLOBALE VARIABLEN (Bindings)
// frame: Zugriff auf die im 'FrameData'-Struct definierten Kamera- und Umgebungseinstellungen.
@group(0) @binding(0) var<uniform> frame: FrameData;
// particles: Lesezugriff auf das Array aller existierenden Partikel aus dem Speicher.
@group(0) @binding(2) var<storage, read> particles: array<Particle>;

// STRUCT: VertexOutput
// Definiert die Daten, die vom Vertex-Shader an den Fragment-Shader weitergereicht werden.
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

// Baut die Positions- und Farbwerte für das Partikel-Trail-Mesh auf.
@vertex
fn vertexMain(@builtin(instance_index) instanceIdx: u32, @builtin(vertex_index) vertexIdx: u32) -> VertexOutput {
    var out: VertexOutput;
    let particle = particles[instanceIdx];
    
    // Bestimmt, ob der aktuelle Vertex der Kopf (0) oder der Schweif (1) des Partikels ist.
    let isTrailVertex = vertexIdx == 1u;

    let drawPosition = calculateDrawPosition(particle, isTrailVertex);
    out.position = calculateClipPosition(drawPosition);
    out.color = calculateParticleColor(particle, isTrailVertex);
    return out;
}

// Verschiebt den zweiten Vertex nach hinten, damit der Schweif entsteht.
fn calculateDrawPosition(particle: Particle, isTrailVertex: bool) -> vec3<f32> {
    var drawPosition = particle.posAndAge.xyz;

    // Berechnung: Nur wenn es der Schweif-Vertex ist, wird die Position 
    // entgegen der Bewegungsrichtung verschoben, um den visuellen Pfad zu erzeugen.
    if (isTrailVertex) {
        drawPosition -= particle.velAndMax.xyz * calculateTrailLength(particle);
    }

    return rotateParticlePosition(drawPosition);
}

// Dreht die Partikelposition mit der aktuellen Kameraposition.
fn rotateParticlePosition(position: vec3<f32>) -> vec3<f32> {
    // Führt nacheinander Rotationen um die Y-Achse und X-Achse aus, 
    // basierend auf den Mauseingaben/Kameraeinstellungen aus dem FrameData.
    return rotateX(rotateY(position, frame.rotY), frame.rotX);
}

// Rechnet die 3D-Position in den Clip-Space um.
fn calculateClipPosition(position: vec3<f32>) -> vec4<f32> {
    // 1. Ermittle den Skalierungsfaktor aus Basis-Partikelgröße und aktuellem Kamera-Zoom.
    let scale = PARTICLE_SCALE * frame.zoom;
    
    // 2. Passe die X-Koordinate an das Seitenverhältnis (aspect ratio) des Bildschirms an,
    // um Verzerrungen zu vermeiden.
    // 3. Stauche die Z-Koordinate und verschiebe sie (Z_OFFSET), damit Partikel 
    // korrekt in den Render-Tiefenbereich der Kamera fallen.
    return vec4<f32>((position.x * scale) / frame.aspectRatio, position.y * scale, (position.z * 0.1) + 0.5 - Z_OFFSET, 1.0);
}

// Berechnet die Transparenz für Kopf und Schweif des Partikels.
fn calculateParticleColor(particle: Particle, isTrailVertex: bool) -> vec4<f32> {
    // 1. Berechne das Lebensverhältnis des Partikels (0.0 = gerade geboren, 1.0 = stirbt).
    let lifeRatio = particle.posAndAge.w / particle.velAndMax.w;
    
    // 2. Nutze eine Sinus-Funktion für weiches Ein- und Ausblenden über die Lebenszeit 
    // (Startet bei 0.0, steigt auf 1.0 in der Mitte des Lebens, fällt auf 0.0 am Ende).
    let baseAlpha = sin(lifeRatio * PI);
    
    // 3. Wähle die Grundfarbe: Mische zwischen Kopf- und Schweiffarbe basierend auf dem Vertex-Typ.
    let trailColor = mix(PARTICLE_HEAD_COLOR, PARTICLE_TAIL_COLOR, select(0.0, 1.0, isTrailVertex));
    
    // 4. Mache den Kopf-Vertex deutlich sichtbarer (Boost).
    let headAlpha = baseAlpha * HEAD_ALPHA_BOOST;
    
    // 5. Schwäche das Alpha für den Schweif ab, erzwinge aber ein Minimum, 
    // damit der Schweif nicht komplett unsichtbar wird.
    let tailAlpha = max(baseAlpha * TAIL_ALPHA_MULTIPLIER, MIN_TAIL_ALPHA);
    
    // 6. Weise den final ermittelten Alpha-Wert je nach Vertex-Typ zu.
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
    // 1. Ermittle den Geschwindigkeits-Betrag (Vektorlänge) des Partikels.
    let speed = length(particle.velAndMax.xyz);
    
    // 2. Berechne einen Faktor (0.0 bis 1.0), wie schnell das Partikel im 
    // Verhältnis zur erwarteten Maximalgeschwindigkeit (SPEED_FOR_MAX_TRAIL) ist.
    let speedFactor = clamp(speed / SPEED_FOR_MAX_TRAIL, 0.0, 1.0);
    
    // 3. Interpoliere (mix) zwischen der minimalen und der maximalen Schweiflänge 
    // basierend auf diesem ermittelten Faktor. Schnelle Partikel = langer Schweif.
    return mix(TRAIL_LENGTH_MIN, TRAIL_LENGTH_MAX, speedFactor);
}
`;