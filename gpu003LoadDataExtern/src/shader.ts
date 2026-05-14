export const shaderCode = `
// ==========================================
// 1. DATENSTRUKTUREN & VARIABLEN
// ==========================================

// FrameData definiert das Layout für die Daten, die wir in jedem Frame per JavaScript (timeBuffer) senden.
struct FrameData { 
    time: f32,              // 4 Bytes: Die aktuelle Zeit für die Rotation
    isCloud: f32,           // 4 Bytes: Schalter (0.0 = Erde, 1.0 = Wolken)
    _pad1: vec2<f32>,       // 8 Bytes: Platzhalter (Padding). WebGPU verlangt, dass vec3 (sunDirection) an einer 16-Byte-Grenze beginnt.
    sunDirection: vec3<f32>,// 12 Bytes: Die X,Y,Z Richtung, aus der das Sonnenlicht kommt.
    _pad2: f32,             // 4 Bytes: Füllt das Ende auf, damit die Struktur insgesamt genau 32 Bytes groß ist.
};

// Bindings verknüpfen die Ressourcen aus JavaScript (BindGroup) mit dem Shader.
@group(0) @binding(0) var myTexture: texture_2d<f32>;       // Die Farbtextur (Erde oder Wolken)
@group(0) @binding(1) var mySampler: sampler;               // Der Sampler (entscheidet, ob Pixel weichgezeichnet werden)
@group(0) @binding(2) var<uniform> frame: FrameData;        // Unser Uniform-Buffer (die Variablen oben)
@group(0) @binding(3) var nightTexture: texture_2d<f32>;    // Die Textur für die leuchtenden Städte

// VertexOutput ist das "Paket", das der Vertex-Shader an den Fragment-Shader schickt.
struct VertexOutput {
    @builtin(position) position: vec4<f32>, // Zwingend erforderlich: Wo auf dem 2D-Bildschirm landet der Punkt?
    @location(0) uv: vec2<f32>,             // (Wird aktuell nicht genutzt, da wir UV im Fragment-Shader neu berechnen)
    @location(1) normal: vec3<f32>,         // Die Richtung, in die die Oberfläche an diesem Punkt zeigt (wichtig für Licht).
};

// ==========================================
// 2. DER VERTEX SHADER (Geometrie)
// ==========================================
@vertex
fn vertexMain(@location(0) pos: vec3<f32>) -> VertexOutput {
    var out: VertexOutput;
    
    // Wir erzwingen eine perfekte Kugelform. 'normalize' drückt jeden Punkt auf einen Abstand von genau 1.0 zum Zentrum.
    let pure_pos = normalize(pos);
    
    // Wolken werden 0.5% (0.005) größer gezeichnet als die Erde, um Z-Fighting (Flackern) zu vermeiden.
    let scale = 0.6 + (frame.isCloud * 0.005);
    
    // Wolken werden künstlich ein winziges Stück näher an die Kamera gezogen (Z-Achse).
    let zOffset = frame.isCloud * 0.009;
    
    // Finale Position berechnen: X und Y skalieren, Z flacher machen und den Wolken-Offset anwenden.
    // --> Z-Achse verläuft von 0.0 (sehr nah) bis 1.0 (weit weg)
    //     => Da Daten der Z-Achse von -1 bis +1 normalisiert, Verschiebung auf 0.4-0,6 (Wolken werden etwas näher angezeigt)
    out.position = vec4<f32>(pure_pos.x * (scale - 0.2), pure_pos.y * scale, (pure_pos.z * 0.1) + 0.5 - zOffset, 1.0);
    
    // Da es eine Kugel ist, entspricht die Position (vom Nullpunkt ausgehend) exakt der Normalen (Blickrichtung der Fläche).
    out.normal = pure_pos; 
    
    return out;
}

// ==========================================
// 3. DER FRAGMENT SHADER (Pixel & Farbe)
// ==========================================
@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
    let n = normalize(in.normal); // Stellt sicher, dass die Normale immer Länge 1 hat.
    
    // Wir wandeln den 3D-Punkt in 2D-Koordinaten (u, v) für die Texturkarte um.
    // --> 3D-Koordinate der Erde wird auf Farbwert aus Color_Map.jpg gemapped (nur hier die Farbinformationen)
    // atan2 = Längengrad (Links/Rechts), asin = Breitengrad (Oben/Unten).
    let u = 0.5 - (atan2(n.z, n.x) / (2.0 * 3.14159265));
    let v = 0.5 - (asin(clamp(n.y, -0.99, 0.99)) / 3.14159265);
    let uv = vec2<f32>(u + frame.time, v); // time addieren sorgt für die Rotation!
    
    // Farbe aus der aktuellen Textur auslesen
    let texColor = textureSample(myTexture, mySampler, uv);
    var baseColor = texColor.rgb;
    var alpha = 1.0; // Standardmäßig komplett undurchsichtig
    
    // --- LICHTBERECHNUNG (Lambert) ---
    // Wie sehr schaut dieser Pixel in Richtung der Sonne? (1.0 = voll, 0.0 = Seite, -1.0 = Rückseite)
    let lightIntensity = dot(n, normalize(frame.sunDirection));
    var emission = vec3<f32>(0.0, 0.0, 0.0); // Leuchtkraft für Städte (startet bei Null)
    
    // --- MODUS: WOLKEN ---
    if (frame.isCloud > 0.5) {
        // Helligkeit der Wolkentextur ermitteln (größter Farbkanal)
        let brightness = max(texColor.r, max(texColor.g, texColor.b));
        
        // Wenn der Pixel fast schwarz ist (< 2% Helligkeit), wird er sofort verworfen. Spart Leistung!
        if (brightness < 0.02) { discard; }
        
        alpha = brightness; // Grau wird halbtransparent
        baseColor = vec3<f32>(1.0, 1.0, 1.0); // Wolkenfarbe wird auf reines Weiß erzwungen
    } 
    // --- MODUS: ERDE ---
    else {
        // Nacht-Textur lesen
        let nightColor = textureSample(nightTexture, mySampler, uv).rgb;
        
        // Helligkeit der Nacht-Pixel bestimmen
        let cityBrightness = max(nightColor.r, max(nightColor.g, nightColor.b));
        
        // Filtert Meere und Kontinente aus der Nachtkarte heraus. Nur Lichter > 9% Helligkeit bleiben.
        let cleanLights = smoothstep(0.09, 1.3, cityBrightness);
        
        // Wo ist Tag, wo ist Nacht? -0.2 (Schatten) = 1.0 Mix. 0.1 (Licht) = 0.0 Mix.
        // --> Hierdurch wird die klare Abgrenzung zwischen Tag und Nacht realisiert
        let nightMix = 1.0 - smoothstep(-0.2, 0.1, lightIntensity);
        
        // Die sauberen Lichter mit dem Nacht-Übergang multiplizieren und leicht gelb einfärben (1.0, 0.9, 0.7).
        emission = vec3<f32>(cleanLights, cleanLights, cleanLights) * nightMix * vec3<f32>(1.0, 0.9, 0.7);
    }
    
    // Das finale Sonnenlicht berechnen. Wenn lightIntensity negativ ist (Nacht), bleibt 0.02 Restlicht (Sternenschein).
    let finalLight = max(lightIntensity, 0.02);
    
    // Grundfarbe * Sonnenlicht + Eigenleuchten (Städte)
    let litColor = (baseColor * finalLight) + emission;
    
    // Fertiges Bild ausgeben (Farbe + Transparenz)
    return vec4<f32>(litColor, alpha);
}
`;