export const shaderCode = /*wgsl*/ `
// Speichert die globalen Uniform-Variablen wie Kameraparameter, Sonnenrichtung und Raster-Metadaten für den aktuellen Frame.
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
    gridWidth: f32,
    latStep: f32,
    lonStep: f32,
    pad1: f32,
    pad2: f32,
};

const CLOUD_BASE_SCALE: f32 = 0.6;
const CLOUD_SCALE_BOOST: f32 = 0.005;
const CLOUD_DEPTH_OFFSET: f32 = 0.009;
const MIN_VISIBLE_CLOUD_BRIGHTNESS: f32 = 0.02;
const MIN_SUN_LIGHT: f32 = 0.02;
const NIGHT_LIGHT_START: f32 = -0.2;
const NIGHT_LIGHT_END: f32 = 0.1;
const HEATMAP_ALPHA: f32 = 0.5;
const HEATMAP_BASE_COLOR: vec4<f32> = vec4<f32>(0.1, 0.3, 1.0, HEATMAP_ALPHA);
const HEATMAP_GREEN: vec4<f32> = vec4<f32>(0.1, 0.8, 0.2, HEATMAP_ALPHA);
const HEATMAP_YELLOW: vec4<f32> = vec4<f32>(1.0, 0.9, 0.1, HEATMAP_ALPHA);
const HEATMAP_RED: vec4<f32> = vec4<f32>(1.0, 0.2, 0.1, HEATMAP_ALPHA);
const HEATMAP_DEEP_RED: vec4<f32> = vec4<f32>(0.8, 0.0, 0.1, HEATMAP_ALPHA);

@group(0) @binding(0) var myTexture: texture_2d<f32>;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var<uniform> frame: FrameData;
@group(0) @binding(3) var nightTexture: texture_2d<f32>;

// Repräsentiert die gebündelten Wetterdaten (wie Temperatur und Luftqualität) für einen spezifischen geografischen Rasterpunkt.
struct WeatherPoint {
    latitude: f32,
    longitude: f32,
    temperature: f32,
    windU: f32,
    windV: f32,
    airQuality: f32,
    pad2: f32,
    pad3: f32,
};

// Kapselt ein Array aller Wetterpunkte für den effizienten Storage-Buffer-Zugriff.
struct WeatherData {
    values: array<WeatherPoint>,
};

@group(0) @binding(4) var<storage, read> weather: WeatherData;

// Definiert die eingehenden Attribute eines Vertex, bestehend aus lokaler Position, Normalenvektor und UV-Koordinaten.
struct VertexInput {
    @location(0) position: vec4<f32>,
    @location(1) normal: vec4<f32>,
    @location(2) uv: vec2<f32>,
};

// Definiert die weitergegebenen Daten vom Vertex- zum Fragment-Shader, einschließlich der projizierten Bildschirmposition.
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) normal: vec3<f32>,
};

// Rotiert und projiziert die Vertex-Positionen und Normalen der Kugel basierend auf den aktuellen Kamera- und Rotationsparametern.
@vertex
fn vertexMain(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.uv = in.uv;
    let rotatedPosition = rotateGlobe(in.position.xyz);
    out.position = calculateScreenPosition(rotatedPosition);
    out.normal = rotateGlobe(in.normal.xyz);
    return out;
}

// Führt die vollständige Rotation eines 3D-Punktes auf der Kugel um die X- und Y-Achse durch.
fn rotateGlobe(position: vec3<f32>) -> vec3<f32> {
    let rotatedAroundY = rotateY(position, frame.rotY);
    return rotateX(rotatedAroundY, frame.rotX);
}

// Rotiert einen 3D-Vektor um den angegebenen Winkel um die X-Achse.
fn rotateX(position: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(position.x, position.y * c - position.z * s, position.y * s + position.z * c);
}

// Rotiert einen 3D-Vektor um den angegebenen Winkel um die Y-Achse.
fn rotateY(position: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(position.x * c + position.z * s, position.y, -position.x * s + position.z * c);
}

// Berechnet die finale 2D-Bildschirmposition unter Berücksichtigung von Skalierung, Zoom, Seitenverhältnis und dem Wolken-Tiefenversatz.
fn calculateScreenPosition(position: vec3<f32>) -> vec4<f32> {
    let globeScale = (CLOUD_BASE_SCALE + (frame.isCloud * CLOUD_SCALE_BOOST)) * frame.zoom;
    let depthOffset = frame.isCloud * CLOUD_DEPTH_OFFSET;
    return vec4<f32>((position.x * globeScale) / frame.aspectRatio, position.y * globeScale, (position.z * 0.1) + 0.5 - depthOffset, 1.0);
}

// Bestimmt die finale Pixelfarbe durch Beleuchtungsberechnung und ruft je nach Ebene (Wolke/Erde) die entsprechende Render-Funktion auf.
@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
    let normal = normalize(in.normal);
    let sunLight = calculateSunLight(normal);
    
    if (frame.isCloud > 0.5) {
        return renderCloudLayer(in.uv, sunLight);
    }
    return renderEarthLayer(in.uv, sunLight);
}

// Berechnet die Intensität des Sonnenlichts basierend auf dem Skalarprodukt zwischen der Oberflächennormalen und der Sonnenrichtung.
fn calculateSunLight(normal: vec3<f32>) -> f32 {
    let sunDirection = normalize(vec3<f32>(frame.sunDirX, frame.sunDirY, frame.sunDirZ));
    return dot(normal, sunDirection);
}

// Zeichnet die Wolkenschicht durch Auswertung der Texturhelligkeit und verwirft stark transparente Pixel zur Leistungsoptimierung (Discard).
fn renderCloudLayer(uv: vec2<f32>, sunLight: f32) -> vec4<f32> {
    let cloudColor = textureSample(myTexture, mySampler, uv);
    let cloudBrightness = max(cloudColor.r, max(cloudColor.g, cloudColor.b));
    if (cloudBrightness < MIN_VISIBLE_CLOUD_BRIGHTNESS) { discard; }
    
    let cloudAlpha = cloudBrightness * 0.8;
    let visibleLight = max(sunLight, MIN_SUN_LIGHT);
    return vec4<f32>(vec3<f32>(visibleLight), cloudAlpha);
}

// Rendert die Erdoberfläche und blendet je nach Modus entweder eine Wetter-Heatmap oder städtische Nachtlichter auf der dunklen Seite ein.
fn renderEarthLayer(uv: vec2<f32>, sunLight: f32) -> vec4<f32> {
    let surfaceColor = textureSample(myTexture, mySampler, uv).rgb;
    let weatherOverlayEnabled = usesWeatherOverlay(frame.weatherMode, frame.weatherPointCount);
    var shadedSurfaceColor = surfaceColor;
    var emissiveColor = vec3<f32>(0.0, 0.0, 0.0);
    
    if (weatherOverlayEnabled) {
        let heatmapColor = applyHeatmap(uv, frame.weatherMode);
        shadedSurfaceColor = mix(surfaceColor, heatmapColor.rgb, heatmapColor.a);
    } else {
        emissiveColor = calculateNightLights(uv, sunLight);
    }
    
    let visibleLight = max(sunLight, MIN_SUN_LIGHT);
    return vec4<f32>((shadedSurfaceColor * visibleLight) + emissiveColor, 1.0);
}

// Prüft, ob gültige Wetterpunkte vorliegen und ein wetterbezogener Darstellungsmodus (Temperatur oder AQI) aktiv ist.
fn usesWeatherOverlay(mode: f32, pointCount: f32) -> bool {
    return pointCount > 0.0 && (mode == 1.0 || mode == 3.0);
}

// Berechnet die Emission von Stadtlichtern, die sanft in den unbeleuchteten Bereichen des Globus (Nachtseite) eingeblendet werden.
fn calculateNightLights(uv: vec2<f32>, sunLight: f32) -> vec3<f32> {
    let nightColor = textureSample(nightTexture, mySampler, uv).rgb;
    let cityBrightness = max(nightColor.r, max(nightColor.g, nightColor.b));
    let cityLight = smoothstep(0.09, 1.3, cityBrightness);
    let nightBlend = 1.0 - smoothstep(NIGHT_LIGHT_START, NIGHT_LIGHT_END, sunLight);
    return vec3<f32>(cityLight) * nightBlend * vec3<f32>(1.0, 0.9, 0.7);
}

// Ermittelt durch bilineare Interpolation der vier nächstgelegenen Rasterpunkte den lokalen Wetterwert und wandelt ihn in eine Heatmap-Farbe um.
fn applyHeatmap(uv: vec2<f32>, mode: f32) -> vec4<f32> {
    let lastIndex = arrayLength(&weather.values) - 1u;
    if (lastIndex <= 0u) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }

    let lat = (0.5 - uv.y) * 180.0;
    let lon = (uv.x * 360.0) - 180.0;

    let latitudeIndex = (90.0 - lat) / frame.latStep;
    let longitudeIndex = (lon + 180.0) / frame.lonStep;

    let rowCount = u32(180.0 / frame.latStep);
    let columnCount = u32(frame.gridWidth);

    let row0 = clamp(u32(floor(latitudeIndex)), 0u, rowCount);
    let row1 = clamp(row0 + 1u, 0u, rowCount);
    
    let column0 = u32(floor(longitudeIndex)) % columnCount;
    let column1 = (column0 + 1u) % columnCount;

    let index00 = min(row0 * columnCount + column0, lastIndex);
    let index10 = min(row1 * columnCount + column0, lastIndex);
    let index01 = min(row0 * columnCount + column1, lastIndex);
    let index11 = min(row1 * columnCount + column1, lastIndex);

    let value00 = sampleWeatherValue(index00, mode);
    let value10 = sampleWeatherValue(index10, mode);
    let value01 = sampleWeatherValue(index01, mode);
    let value11 = sampleWeatherValue(index11, mode);

    let interpolatedValue = bilinearInterpolate(
        value00,
        value10,
        value01,
        value11,
        fract(latitudeIndex),
        fract(longitudeIndex)
    );

    return mapHeatmapColor(interpolatedValue, mode);
}

// Liest je nach aktivem Modus selektiv den Wert für Temperatur oder Luftqualität aus dem angegebenen Speicherindex aus.
fn sampleWeatherValue(index: u32, mode: f32) -> f32 {
    if (mode == 1.0) {
        return weather.values[index].temperature;
    }
    return weather.values[index].airQuality;
}

// Führt eine standardmäßige 2D-Interpolation zwischen vier Nachbarwerten basierend auf den fraktionalen UV-Koordinaten durch.
fn bilinearInterpolate(v00: f32, v10: f32, v01: f32, v11: f32, fracLat: f32, fracLon: f32) -> f32 {
    let topRow = mix(v00, v01, fracLon);
    let bottomRow = mix(v10, v11, fracLon);
    return mix(topRow, bottomRow, fracLat);
}

// Leitet den interpolierten Metrik-Wert an die spezifische Farbskala-Funktion für Temperatur oder Luftqualität weiter.
fn mapHeatmapColor(value: f32, mode: f32) -> vec4<f32> {
    if (mode == 1.0) {
        return mapTemperatureColor(value);
    }
    return mapAirQualityColor(value);
}

// Weist einem Temperaturwert (in Celsius) eine entsprechende Farbe aus einem vordefinierten Verlauf (Blau über Grün/Gelb zu Rot) zu.
fn mapTemperatureColor(value: f32) -> vec4<f32> {
    if (value <= -10.0) { return HEATMAP_BASE_COLOR; }
    if (value <= 10.0) { return mix(HEATMAP_BASE_COLOR, HEATMAP_GREEN, (value + 10.0) / 20.0); }
    if (value <= 25.0) { return mix(HEATMAP_GREEN, HEATMAP_YELLOW, (value - 10.0) / 15.0); }
    if (value <= 35.0) { return mix(HEATMAP_YELLOW, HEATMAP_RED, (value - 25.0) / 10.0); }
    return HEATMAP_RED;
}

// Weist einem Luftqualitätsindex (AQI) eine Farbe aus einem gesundheitlichen Warnstufen-Verlauf (Blau bis Dunkelrot) zu.
fn mapAirQualityColor(value: f32) -> vec4<f32> {
    if (value <= 50.0) { return HEATMAP_BASE_COLOR; }
    if (value <= 100.0) { return mix(HEATMAP_BASE_COLOR, HEATMAP_GREEN, (value - 50.0) / 50.0); }
    if (value <= 150.0) { return mix(HEATMAP_GREEN, HEATMAP_YELLOW, (value - 100.0) / 50.0); }
    if (value <= 200.0) { return mix(HEATMAP_YELLOW, HEATMAP_RED, (value - 150.0) / 50.0); }
    return HEATMAP_DEEP_RED;
}
`;
