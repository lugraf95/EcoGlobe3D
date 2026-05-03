export const shaderCode = `

// 1. NEU: DAS DATENPAKET (Struct)
// Wir definieren, was der Vertex Shader an den Fragment Shader übergibt
struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

// 2. DER ARCHITEKT (Vertex Shader)
// Der Rückgabewert ist jetzt nicht mehr nur ein vec4, sondern unser struct "VertexOut"
@vertex
fn vertexMain(@builtin(vertex_index) v_index: u32) -> VertexOut {
    
    // Die 3 Koordinaten
    var pos = array<vec2<f32>, 3>(
        vec2<f32>( 0.0,  0.5), // Spitze oben
        vec2<f32>(-0.5, -0.5), // Unten links
        vec2<f32>( 0.5, -0.5)  // Unten rechts
    );

    // NEU: Die 3 Farben für die jeweiligen Ecken
    var colors = array<vec4<f32>, 3>(
        vec4<f32>(1.0, 0.0, 0.0, 1.0), // Rot (für Spitze oben)
        vec4<f32>(0.0, 1.0, 0.0, 1.0), // Grün (für unten links)
        vec4<f32>(0.0, 0.0, 1.0, 1.0)  // Blau (für unten rechts)
    );

    // Wir schnüren das Paket zusammen
    var output: VertexOut;
    output.position = vec4<f32>(pos[v_index], 0.0, 1.0);
    output.color = colors[v_index]; 
    
    return output;
}

// 3. DER MALER (Fragment Shader)
// Erwartet nun die Farbe als Eingangsparameter an Location 0
@fragment
fn fragmentMain(@location(0) vertexColor: vec4<f32>) -> @location(0) vec4<f32> {
    
    // Er gibt einfach die Farbe zurück, die er vom Fließband bekommt
    return vertexColor; 
}
`;