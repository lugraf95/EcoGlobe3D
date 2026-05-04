export const shaderCode = `@group(0) @binding(0) var myTexture: texture_2d<f32>;
@group(0) @binding(1) var mySampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

const PI: f32 = 3.14159265359;

@vertex
fn vertexMain(
    @location(0) pos: vec3<f32>, 
    @location(1) ignored_uv: vec2<f32> 
) -> VertexOutput {
    var output: VertexOutput;
    
    // Z-Schere verhindern: Wir stauchen die Z-Achse stark zusammen (* 0.2), 
    // damit garantiert nichts mehr aus dem [0, 1] Raum herausragt!
    output.position = vec4<f32>(pos.x * 0.5, pos.y * 0.5, pos.z * 0.2 + 0.5, 1.0); 

    let normPos = normalize(pos);
    
    // SICHERHEITS-CLAMP: Verhindert die NaN Explosion bei y > 1.0!
    let safeY = clamp(normPos.y, -1.0, 1.0);
    
    let u = 0.5 + (atan2(normPos.z, normPos.x) / (2.0 * PI));
    let v = 0.5 - (asin(safeY) / PI);
    
    output.uv = vec2<f32>(u, v);
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(myTexture, mySampler, input.uv); 
}
`;