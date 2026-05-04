import { shaderCode } from "./shader";

const canvas = document.querySelector<HTMLCanvasElement>("#testWebGPU")!;

// ==========================================
// HILFSFUNKTION: TEXTUREN LADEN
// ==========================================
async function loadTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
    const img = new Image();
    img.src = url;
    await img.decode(); // Wartet, bis das Bild vom Browser entpackt wurde
    const imageBitmap = await createImageBitmap(img); // Konvertiert es in ein GPU-freundliches Format
    
    // Erstellt einen leeren Speicherbereich auf der Grafikkarte für das Bild
    const texture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height, 1],
        format: 'rgba8unorm', // 8 Bit pro Kanal (Rot, Grün, Blau, Alpha)
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    
    // Kopiert die Bilddaten aus dem RAM in den VRAM (Grafikkartenspeicher)
    device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture }, [imageBitmap.width, imageBitmap.height]);
    return texture;
}

// ==========================================
// HILFSFUNKTION: 3D-MODELLE (GLB) PARSEN
// ==========================================
async function loadAllGLBLayers(url: string) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer(); // Lädt die rohe Binärdatei (.glb)
    const dataView = new DataView(arrayBuffer);
    
    // GLB-Dateien haben einen Header. An Byte 12 steht, wie lang der JSON-Teil ist.
    const jsonChunkLength = dataView.getUint32(12, true);
    
    // JSON (Text) extrahieren, der beschreibt, wo welche Daten (Vertices) liegen
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonChunkLength)));
    const binOffset = 20 + jsonChunkLength + 8; // Ab hier beginnen die echten 3D-Zahlenwerte

    // Sucht die rohen Zahlen aus dem Puffer anhand der GLTF-Spezifikation
    function getTypedArray(accessorId: number) {
        const acc = json.accessors[accessorId];
        const view = json.bufferViews[acc.bufferView];
        const offset = binOffset + (view.byteOffset || 0) + (acc.byteOffset || 0);
        
        if (acc.componentType === 5123) return new Uint16Array(arrayBuffer, offset, acc.count); // 16-Bit Indices
        if (acc.componentType === 5125) return new Uint32Array(arrayBuffer, offset, acc.count); // 32-Bit Indices
        return new Float32Array(arrayBuffer, offset, acc.count * 3); // Positionen (X, Y, Z)
    }

    // Wandelt das optimierte 3D-Format (Positionen + Indices) in eine einfache, flache Liste von Dreiecken um
    function processMesh(meshName: string) {
        const mesh = json.meshes.find((m: any) => m.name === meshName) || json.meshes[0];
        const prim = mesh.primitives[0];
        const pos = getTypedArray(prim.attributes.POSITION) as Float32Array;
        const indices = getTypedArray(prim.indices) as Uint16Array | Uint32Array;
        
        const data = new Float32Array(indices.length * 3);
        for (let i = 0; i < indices.length; i++) {
            const idx = indices[i];
            // Sucht für jeden Eckpunkt eines Dreiecks die passenden X, Y, Z Werte heraus
            data[i * 3 + 0] = pos[idx * 3 + 0];
            data[i * 3 + 1] = pos[idx * 3 + 1];
            data[i * 3 + 2] = pos[idx * 3 + 2];
        }
        return data; // Gibt ein Array voller Dreiecks-Punkte zurück
    }

    return {
        earth: processMesh("Sphere"),
        clouds: processMesh("Sphere.001"),
        atmosphere: processMesh("Sphere.002") // (Atmosphäre wird aktuell nicht gerendert)
    };
}

// ==========================================
// HAUPTFUNKTION: WEBGPU SETUP & RENDER-LOOP
// ==========================================
async function initWebGPU() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    // 1. GPU Adapter anfordern (Grafikkarte suchen)
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Kein Adapter gefunden");

    // 2. Device (Sitzung mit der GPU) anfordern und erlauben, dass Texturen bis zu 16k/32k groß sein dürfen
    const device = await adapter.requestDevice({
        requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D }
    });

    if (adapter.limits.maxTextureDimension2D < 10800) {
        console.warn("Deine Hardware unterstützt keine 10k Texturen.");
    }

    // 3. Canvas für WebGPU konfigurieren
    const context = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    // 4. Lade alle Assets (Modelle und 3 Bilder) asynchron herunter
    const layers = await loadAllGLBLayers('/earth.glb');
    const earthTex = await loadTexture(device, '/Color_Map.jpg');
    const cloudTex = await loadTexture(device, '/Clouds.png');
    const nightTex = await loadTexture(device, '/Night_Lights.jpg');
    
    // Sampler bestimmt, wie Texturen vergrößert/verkleinert werden (linear = weiche Übergänge)
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat' });

    // 5. Speicher für Uniform-Variablen (Zeit, Lichtrichtung) auf der GPU reservieren
    const earthTimeBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cloudTimeBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Hilfsfunktion, um die Vertex-Arrays in GPU-Speicher (Buffer) zu laden
    const createBuf = (data: Float32Array) => {
        const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(buf, 0, data);
        return buf;
    };

    const earthBuf = createBuf(layers.earth);
    const cloudBuf = createBuf(layers.clouds);

    // 6. Die Render-Pipeline definieren (Das Regelwerk der Grafikkarte)
    const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: device.createShaderModule({ code: shaderCode }),
            entryPoint: "vertexMain",
            // ArrayStride = 12: Jeder Vertex besteht aus 3 Floats (X,Y,Z) * 4 Bytes = 12 Bytes.
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }]
        },
        fragment: {
            module: device.createShaderModule({ code: shaderCode }),
            entryPoint: "fragmentMain",
            targets: [{ 
                format, 
                // Aktiviert Transparenz (Alpha Blending) für die Wolken
                blend: {
                    color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                    alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }
                }
            }]
        },
        primitive: { topology: "triangle-list", cullMode: "back" }, // Rückseiten von Dreiecken nicht zeichnen
        depthStencil: { 
            depthWriteEnabled: true,       // Z-Werte speichern
            depthCompare: 'less-equal',    // Nur zeichnen, wenn das Objekt näher (oder gleich nah) an der Kamera ist
            format: 'depth24plus'          // 24-Bit Genauigkeit für die Tiefe
        }
    });

    // 7. BindGroups erstellen. Sie "binden" die konkreten Texturen und Puffer an die im Shader definierten @bindings.
    const earthBG = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: earthTex.createView() },    // Farbkarte
            { binding: 1, resource: sampler },                  // Sampler
            { binding: 2, resource: { buffer: earthTimeBuf } }, // Zeit-Puffer für Erde
            { binding: 3, resource: nightTex.createView() }     // Stadtlichter
        ]
    });

    const cloudBG = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: cloudTex.createView() },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: cloudTimeBuf } },
            { binding: 3, resource: cloudTex.createView() }     // Platzhalter (Dummy), wird von Wolken nicht genutzt
        ]
    });

    // 8. Tiefentextur erstellen (Das unsichtbare Z-Buffer-Bild)
    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    
    // 9. DIE ENDLOSSCHLEIFE (Render-Loop)
    function render(now: number) {
        const time = now / 1000.0;
        const encoder = device.createCommandEncoder(); // Nimmt GPU-Befehle auf
        
        // Pass definiert, wohin gezeichnet wird (Canvas) und wie er gereinigt wird
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0.01, g: 0.01, b: 0.05, a: 1.0 }, // Dunkelblauer Weltraum-Hintergrund
                loadOp: "clear", storeOp: "store",
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1.0,  // "Säubert" den Tiefenpuffer auf unendliche Entfernung
                depthLoadOp: 'clear', 
                depthStoreOp: 'store'
            }
        });

        pass.setPipeline(pipeline);
        
        // Lichtrichtung (Sonne kommt von rechts unten vorne)
        const sunDirX = 0.67;
        const sunDirY = 0.0;
        const sunDirZ = 0.13;

        // --- ERDE ---
        // Puffer aktualisieren (isCloud = 0.0)
        device.queue.writeBuffer(earthTimeBuf, 0, new Float32Array([
            time * 0.02, 0.0, 0, 0,       
            sunDirX, sunDirY, sunDirZ, 0 
        ]));
        pass.setVertexBuffer(0, earthBuf);   // 3D-Modell anlegen
        pass.setBindGroup(0, earthBG);       // Texturen anlegen
        pass.draw(layers.earth.length / 3);  // Ausführen! (Anzahl der Vertices = ArrayLänge / 3)

        // --- WOLKEN ---
        // Puffer aktualisieren (isCloud = 1.0, drehen sich minimal schneller: 0.03)
        device.queue.writeBuffer(cloudTimeBuf, 0, new Float32Array([
            time * 0.03, 1.0, 0, 0,       
            sunDirX, sunDirY, sunDirZ, 0 
        ]));
        pass.setVertexBuffer(0, cloudBuf);
        pass.setBindGroup(0, cloudBG);
        pass.draw(layers.clouds.length / 3);

        pass.end(); // Aufnahme beenden
        device.queue.submit([encoder.finish()]); // Befehle an die GPU senden
        
        requestAnimationFrame(render); // Nächsten Frame planen
    }
    
    // Startschuss!
    requestAnimationFrame(render);
}

initWebGPU().catch(e => console.error(e));