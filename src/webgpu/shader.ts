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

// Baut die Positions- und Normalenwerte für das Kugel-Mesh auf.
@vertex
fn vertexMain(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.uv = in.uv;
    let rotatedPosition = rotateGlobe(in.position.xyz);
    out.position = calculateScreenPosition(rotatedPosition);
    out.normal = rotateGlobe(in.normal.xyz);
    return out;
}

fn rotateGlobe(position: vec3<f32>) -> vec3<f32> {
    let rotatedAroundY = rotateY(position, frame.rotY);
    return rotateX(rotatedAroundY, frame.rotX);
}

fn rotateX(position: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(position.x, position.y * c - position.z * s, position.y * s + position.z * c);
}

fn rotateY(position: vec3<f32>, angle: f32) -> vec3<f32> {
    let s = sin(angle); let c = cos(angle);
    return vec3<f32>(position.x * c + position.z * s, position.y, -position.x * s + position.z * c);
}

fn calculateScreenPosition(position: vec3<f32>) -> vec4<f32> {
    let globeScale = (CLOUD_BASE_SCALE + (frame.isCloud * CLOUD_SCALE_BOOST)) * frame.zoom;
    let depthOffset = frame.isCloud * CLOUD_DEPTH_OFFSET;
    return vec4<f32>((position.x * globeScale) / frame.aspectRatio, position.y * globeScale, (position.z * 0.1) + 0.5 - depthOffset, 1.0);
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
    let normal = normalize(in.normal);
    let sunLight = calculateSunLight(normal);
    
    if (frame.isCloud > 0.5) {
        return renderCloudLayer(in.uv, sunLight);
    }
    return renderEarthLayer(in.uv, sunLight);
}

fn calculateSunLight(normal: vec3<f32>) -> f32 {
    let sunDirection = normalize(vec3<f32>(frame.sunDirX, frame.sunDirY, frame.sunDirZ));
    return dot(normal, sunDirection);
}

// Zeichnet die Wolken mit einer einfachen Helligkeitsmaske aus dem Texturwert.
fn renderCloudLayer(uv: vec2<f32>, sunLight: f32) -> vec4<f32> {
    let cloudColor = textureSample(myTexture, mySampler, uv);
    let cloudBrightness = max(cloudColor.r, max(cloudColor.g, cloudColor.b));
    if (cloudBrightness < MIN_VISIBLE_CLOUD_BRIGHTNESS) { discard; }
    
    let cloudAlpha = cloudBrightness * 0.8;
    let visibleLight = max(sunLight, MIN_SUN_LIGHT);
    return vec4<f32>(vec3<f32>(visibleLight), cloudAlpha);
}

fn renderEarthLayer(uv: vec2<f32>, sunLight: f32) -> vec4<f32> {
    let surfaceColor = textureSample(myTexture, mySampler, uv).rgb;
    let weatherOverlayEnabled = usesWeatherOverlay(frame.weatherMode, frame.weatherPointCount);
    var shadedSurfaceColor = surfaceColor;
    var emissiveColor = vec3<f32>(0.0, 0.0, 0.0);
    
    if (weatherOverlayEnabled) {
        // Bei Wettermodus wird die Oberflächenfarbe mit der Heatmap überblendet.
        let heatmapColor = applyHeatmap(uv, frame.weatherMode);
        shadedSurfaceColor = mix(surfaceColor, heatmapColor.rgb, heatmapColor.a);
    } else {
        // Ohne Wetterdaten werden die Nachtslichter auf der dunklen Seite eingeblendet.
        emissiveColor = calculateNightLights(uv, sunLight);
    }
    
    let visibleLight = max(sunLight, MIN_SUN_LIGHT);
    return vec4<f32>((shadedSurfaceColor * visibleLight) + emissiveColor, 1.0);
}

fn usesWeatherOverlay(mode: f32, pointCount: f32) -> bool {
    return pointCount > 0.0 && (mode == 1.0 || mode == 3.0);
}

fn calculateNightLights(uv: vec2<f32>, sunLight: f32) -> vec3<f32> {
    let nightColor = textureSample(nightTexture, mySampler, uv).rgb;
    let cityBrightness = max(nightColor.r, max(nightColor.g, nightColor.b));
    let cityLight = smoothstep(0.09, 1.3, cityBrightness);
    let nightBlend = 1.0 - smoothstep(NIGHT_LIGHT_START, NIGHT_LIGHT_END, sunLight);
    return vec3<f32>(cityLight) * nightBlend * vec3<f32>(1.0, 0.9, 0.7);
}

// Wetterwerte per bilinearer Interpolation aus den vier Nachbarpunkten bestimmen.
fn applyHeatmap(uv: vec2<f32>, mode: f32) -> vec4<f32> {
    let lastIndex = arrayLength(&weather.values) - 1u;
    if (lastIndex <= 0u) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }

    let lat = (0.5 - uv.y) * 180.0;
    let lon = (uv.x * 360.0) - 180.0;

    let latitudeIndex = (90.0 - lat) / frame.latStep;
    let longitudeIndex = (lon + 180.0) / frame.lonStep;

    let rowCount = u32(180.0 / frame.latStep);
    let columnCount = u32(frame.gridWidth);

    // Die zwei benachbarten Rasterzeilen werden auf gültige Indizes begrenzt.
    let row0 = clamp(u32(floor(latitudeIndex)), 0u, rowCount);
    let row1 = clamp(row0 + 1u, 0u, rowCount);
    
    // Die Spalten laufen zyklisch, damit der Übergang an der Datumsgrenze sauber bleibt.
    let column0 = u32(floor(longitudeIndex)) % columnCount;
    let column1 = (column0 + 1u) % columnCount;

    let index00 = min(row0 * columnCount + column0, lastIndex);
    let index10 = min(row1 * columnCount + column0, lastIndex);
    let index01 = min(row0 * columnCount + column1, lastIndex);
    let index11 = min(row1 * columnCount + column1, lastIndex);

    // Je nach Modus wird Temperatur oder Luftqualität aus denselben Rasterpunkten gelesen.
    let value00 = sampleWeatherValue(index00, mode);
    let value10 = sampleWeatherValue(index10, mode);
    let value01 = sampleWeatherValue(index01, mode);
    let value11 = sampleWeatherValue(index11, mode);

    // Aus den vier Stützstellen wird der geglättete Endwert berechnet.
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

fn sampleWeatherValue(index: u32, mode: f32) -> f32 {
    if (mode == 1.0) {
        return weather.values[index].temperature;
    }
    return weather.values[index].airQuality;
}

fn bilinearInterpolate(v00: f32, v10: f32, v01: f32, v11: f32, fracLat: f32, fracLon: f32) -> f32 {
    let topRow = mix(v00, v01, fracLon);
    let bottomRow = mix(v10, v11, fracLon);
    return mix(topRow, bottomRow, fracLat);
}

fn mapHeatmapColor(value: f32, mode: f32) -> vec4<f32> {
    if (mode == 1.0) {
        return mapTemperatureColor(value);
    }
    return mapAirQualityColor(value);
}

fn mapTemperatureColor(value: f32) -> vec4<f32> {
    if (value <= -10.0) { return HEATMAP_BASE_COLOR; }
    if (value <= 10.0) { return mix(HEATMAP_BASE_COLOR, HEATMAP_GREEN, (value + 10.0) / 20.0); }
    if (value <= 25.0) { return mix(HEATMAP_GREEN, HEATMAP_YELLOW, (value - 10.0) / 15.0); }
    if (value <= 35.0) { return mix(HEATMAP_YELLOW, HEATMAP_RED, (value - 25.0) / 10.0); }
    return HEATMAP_RED;
}

fn mapAirQualityColor(value: f32) -> vec4<f32> {
    if (value <= 50.0) { return HEATMAP_BASE_COLOR; }
    if (value <= 100.0) { return mix(HEATMAP_BASE_COLOR, HEATMAP_GREEN, (value - 50.0) / 50.0); }
    if (value <= 150.0) { return mix(HEATMAP_GREEN, HEATMAP_YELLOW, (value - 100.0) / 50.0); }
    if (value <= 200.0) { return mix(HEATMAP_YELLOW, HEATMAP_RED, (value - 150.0) / 50.0); }
    return HEATMAP_DEEP_RED;
}
`;