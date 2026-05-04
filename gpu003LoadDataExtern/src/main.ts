import { shaderCode } from "./shader";

const hot = import.meta.hot;
if (hot) {
    hot.accept(() => {
        hot.invalidate();
    });
}

const canvas = document.querySelector<HTMLCanvasElement>("#testWebGPU");

// =====================================================================
// 1. ENGINE HELFER: TEXTUR LADEN
// =====================================================================
async function loadTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
    const img = new Image();
    img.src = url;
    await img.decode(); 
    const imageBitmap = await createImageBitmap(img);

    const texture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height, 1],
        format: 'rgba8unorm', 
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture: texture },
        [imageBitmap.width, imageBitmap.height]
    );

    return texture;
}

// =====================================================================
// 2. ENGINE HELFER: PURE VANILLA GLB BINARY HACKER
// =====================================================================
async function loadGLB(url: string): Promise<Float32Array> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const dataView = new DataView(arrayBuffer);

    // GLB Header lesen
    const magic = dataView.getUint32(0, true);
    if (magic !== 0x46546C67) throw new Error("Das ist keine GLB Datei!");

    // JSON Inhaltsverzeichnis lesen
    const jsonChunkLength = dataView.getUint32(12, true);
    const jsonString = new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonChunkLength));
    const json = JSON.parse(jsonString);

    // Startpunkt der rohen Binärdaten berechnen (Byte 28 + JSON Länge)
    const binDataOffset = 20 + jsonChunkLength + 8;

    // Erde suchen (meshes[2] laut deinem Dump!)
    const mesh = json.meshes.find((m: any) => m.name === "Sphere") || json.meshes[0];
    const primitive = mesh.primitives[0];

    function getArray(accessorId: number | undefined) {
        if (accessorId === undefined) return null;
        
        const accessor = json.accessors[accessorId];
        const bufferView = json.bufferViews[accessor.bufferView];
        const byteOffset = binDataOffset + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);

        if (accessor.componentType === 5126) {
            const numComponents = accessor.type === 'VEC3' ? 3 : 2;
            return new Float32Array(arrayBuffer, byteOffset, accessor.count * numComponents);
        } else if (accessor.componentType === 5123) {
            return new Uint16Array(arrayBuffer, byteOffset, accessor.count);
        } else if (accessor.componentType === 5125) {
            return new Uint32Array(arrayBuffer, byteOffset, accessor.count);
        }
        throw new Error("Datentyp nicht unterstützt");
    }

    const rawPositions = getArray(primitive.attributes.POSITION) as Float32Array;
    const indices = getArray(primitive.indices) as Uint16Array | Uint32Array | null;

    let finalData: Float32Array;

    // Komprimierte Dreiecke entrollen!
    if (indices) {
        finalData = new Float32Array(indices.length * 5); 
        for (let i = 0; i < indices.length; i++) {
            const idx = indices[i];
            
            finalData[i * 5 + 0] = rawPositions[idx * 3 + 0];
            finalData[i * 5 + 1] = rawPositions[idx * 3 + 1];
            finalData[i * 5 + 2] = rawPositions[idx * 3 + 2];
            finalData[i * 5 + 3] = 0; // Shader berechnet UVs neu!
            finalData[i * 5 + 4] = 0;
        }
    } else {
        const vertexCount = rawPositions.length / 3;
        finalData = new Float32Array(vertexCount * 5);
        for (let i = 0; i < vertexCount; i++) {
            finalData[i * 5 + 0] = rawPositions[i * 3 + 0];
            finalData[i * 5 + 1] = rawPositions[i * 3 + 1];
            finalData[i * 5 + 2] = rawPositions[i * 3 + 2];
            finalData[i * 5 + 3] = 0;
            finalData[i * 5 + 4] = 0;
        }
    }
    
    return finalData;
}

// =====================================================================
// 3. HAUPTPROGRAMM (RENDER LOOP)
// =====================================================================
async function initWebGPU() {
    if (!navigator.gpu) throw new Error("WebGPU is not supported");
    if (!canvas) throw new Error("Canvas not found");
    
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice({
        requiredLimits: { maxTextureDimension2D: adapter!.limits.maxTextureDimension2D }
    });

    const context = canvas.getContext("webgpu") as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({ device, format, alphaMode: "opaque" });

    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height, 1],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

    const vertexData = await loadGLB('/earth.glb'); 
    const vertexCount = vertexData.length / 5; 

    const vertexBuffer = device.createBuffer({
        size: vertexData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertexData);

    const earthTexture = await loadTexture(device, '/Color_Map.jpg');
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    const shaderModule = device.createShaderModule({ code: shaderCode });

    const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: shaderModule,
            entryPoint: "vertexMain",
            buffers: [{
                arrayStride: 20, 
                attributes: [
                    { shaderLocation: 0, offset: 0, format: "float32x3" },
                    { shaderLocation: 1, offset: 12, format: "float32x2" } 
                ]
            }]
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: format }]
        },
        primitive: { topology: "triangle-list" },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus'
        }
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: earthTexture.createView() },
            { binding: 1, resource: sampler }
        ]
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.1, g: 0.2, b: 0.4, a: 1.0 }, // TIEFBLAUER WELTRAUM ZUM TESTEN!
            loadOp: "clear",
            storeOp: "store",
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store'
        }
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer); 
    pass.setBindGroup(0, bindGroup);
    pass.draw(vertexCount);
    pass.end();

    device.queue.submit([encoder.finish()]); 
}

initWebGPU();