import { shaderCode } from "./shader";

const canvas = document.querySelector<HTMLCanvasElement>("#testWebGPU")!;

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
    device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture }, [imageBitmap.width, imageBitmap.height]);
    return texture;
}

async function loadAllGLBLayers(url: string) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const dataView = new DataView(arrayBuffer);
    const jsonChunkLength = dataView.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonChunkLength)));
    const binOffset = 20 + jsonChunkLength + 8;

    // FIX: Unterscheidung zwischen Float (Position) und Integer (Indices)
    function getTypedArray(accessorId: number) {
        const acc = json.accessors[accessorId];
        const view = json.bufferViews[acc.bufferView];
        const offset = binOffset + (view.byteOffset || 0) + (acc.byteOffset || 0);
        
        if (acc.componentType === 5123) return new Uint16Array(arrayBuffer, offset, acc.count);
        if (acc.componentType === 5125) return new Uint32Array(arrayBuffer, offset, acc.count);
        return new Float32Array(arrayBuffer, offset, acc.count * 3);
    }

    function processMesh(meshName: string) {
        const mesh = json.meshes.find((m: any) => m.name === meshName) || json.meshes[0];
        const prim = mesh.primitives[0];
        const pos = getTypedArray(prim.attributes.POSITION) as Float32Array;
        const indices = getTypedArray(prim.indices) as Uint16Array | Uint32Array;
        
        const data = new Float32Array(indices.length * 3);
        for (let i = 0; i < indices.length; i++) {
            const idx = indices[i];
            data[i * 3 + 0] = pos[idx * 3 + 0];
            data[i * 3 + 1] = pos[idx * 3 + 1];
            data[i * 3 + 2] = pos[idx * 3 + 2];
        }
        return data;
    }

    return {
        earth: processMesh("Sphere"),
        clouds: processMesh("Sphere.001"),
        atmosphere: processMesh("Sphere.002")
    };
}

async function initWebGPU() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Kein Adapter gefunden");

    // FIX: Wir fordern das maximale Textur-Limit des Adapters an
    const device = await adapter.requestDevice({
        requiredLimits: {
            maxTextureDimension2D: adapter.limits.maxTextureDimension2D
        }
    });

    // Sicherheitshinweis: Falls dein PC keine 10k Texturen unterstützt
    console.log("Max unterstützte Texturgröße:", adapter.limits.maxTextureDimension2D);
    if (adapter.limits.maxTextureDimension2D < 10800) {
        console.warn("Deine Hardware unterstützt keine 10k Texturen. Bitte nutze ein Bild mit max. 8192px!");
    }

    const context = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    const layers = await loadAllGLBLayers('/earth.glb');
    const earthTex = await loadTexture(device, '/Color_Map.jpg');
    const cloudTex = await loadTexture(device, '/Clouds.png');
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat' });

    // PRO-TIP: Uniform Buffer IMMER 16-Byte ausgerichtet (Padding)
    const timeBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const createBuf = (data: Float32Array) => {
        const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(buf, 0, data);
        return buf;
    };

    const earthBuf = createBuf(layers.earth);
    const cloudBuf = createBuf(layers.clouds);

    const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: device.createShaderModule({ code: shaderCode }),
            entryPoint: "vertexMain",
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }]
        },
        fragment: {
            module: device.createShaderModule({ code: shaderCode }),
            entryPoint: "fragmentMain",
            targets: [{ 
                format, 
                blend: {
                    color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                    alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }
                }
            }]
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { 
        depthWriteEnabled: true, 
        depthCompare: 'less-equal', 
        format: 'depth24plus' 
    }
    });

    const createBG = (tex: GPUTexture) => device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: tex.createView() },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: timeBuffer } }
        ]
    });
    const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const earthBG = createBG(earthTex);
    const cloudBG = createBG(cloudTex);

    function render(now: number) {
    const time = now / 1000.0;
    const encoder = device.createCommandEncoder();
    
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.01, g: 0.01, b: 0.05, a: 1.0 },
            loadOp: "clear", storeOp: "store",
        }],
        // FIX: Hier muss die Tiefentextur rein!
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0, 
            depthLoadOp: 'clear', 
            depthStoreOp: 'store'
        }
    });

    pass.setPipeline(pipeline);
    
    // Erde zeichnen
    device.queue.writeBuffer(timeBuffer, 0, new Float32Array([time * 0.02, 0, 0, 0])); // 16-Byte Padding beachten!
    pass.setVertexBuffer(0, earthBuf);
    pass.setBindGroup(0, earthBG);
    pass.draw(layers.earth.length / 3);

    // Wolken zeichnen
    device.queue.writeBuffer(timeBuffer, 0, new Float32Array([time * 0.03, 0, 0, 0]));
    pass.setVertexBuffer(0, cloudBuf);
    pass.setBindGroup(0, cloudBG);
    pass.draw(layers.clouds.length / 3);

    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(render);
}
    requestAnimationFrame(render);
}

initWebGPU().catch(e => console.error(e));