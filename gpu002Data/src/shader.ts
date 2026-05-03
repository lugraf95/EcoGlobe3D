export const shaderCode = `
// Unsere "Fernbedienung" für das Material (Kanal 0, Slot 0)
@group(0) @binding(0) var<uniform> objectColor: vec4<f32>;

@vertex
fn vertexMain(@location(0) position: vec2<f32>) -> @builtin(position) vec4<f32> {
    return vec4<f32>(position, 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
    // Der Maler nutzt jetzt die Farbe aus der Fernbedienung!
    return objectColor; 
}
`;