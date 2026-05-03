import { shaderCode } from "./shader";

const canvas = document.querySelector<HTMLCanvasElement>("#testWebGPU");

async function initWebGPU() {
    if (!navigator.gpu) throw new Error("WebGPU is not supported by this browser.");
    if (!canvas) throw new Error("Canvas element not found.");
    
    // Die Grafikkarte und Schnittstelle anfragen
    const adapter: GPUAdapter | null = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Kein passender Adapter gefunden.");
    const device: GPUDevice = await adapter.requestDevice();

    const context = canvas.getContext("webgpu") as GPUCanvasContext;
    const format: GPUTextureFormat = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device: device,
        format: format,
        alphaMode: "opaque"
    });

    console.log("WebGPU erfolgreich mit TypeScript initialisiert!");

    // =================================================================
    // 1. DATENGETRIEBENE GEOMETRIE (KREIS BERECHNEN)
    // =================================================================
    const segments = 40; 
    const radius = 0.7;
    const vertexDataArray = [];

    for (let i = 0; i < segments; i++) {
        const angle1 = (i / segments) * Math.PI*2;
        const angle2 = ((i + 1) / segments) * Math.PI *2;

        vertexDataArray.push(0.0, 0.0); 
        vertexDataArray.push(radius * Math.cos(angle1), radius * Math.sin(angle1));
        vertexDataArray.push(radius * Math.cos(angle2), radius * Math.sin(angle2));
    } 
    const vertexData = new Float32Array(vertexDataArray);
    const vertexCount = vertexData.length / 2;

    const vertexBuffer = device.createBuffer({
        size: vertexData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertexData);

    // =================================================================
    // 2. SHADER & PIPELINE
    // =================================================================
    const shaderModule = device.createShaderModule({
        code: shaderCode
    });

    const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: shaderModule,
            entryPoint: "vertexMain",
            buffers: [{
                arrayStride: 8, 
                attributes: [{
                    shaderLocation: 0, 
                    offset: 0,         
                    format: "float32x2"
                }]
            }]
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: format }]
        },
        primitive: {
            topology: "triangle-list"
        }
    });

    // =================================================================
    // 3. ENGINE HELFER: MATERIAL ERSTELLEN (Jetzt im richtigen Scope!)
    // =================================================================
    function createMaterial(r: number, g: number, b: number, a: number): GPUBindGroup {
        const colorData = new Float32Array([r, g, b, a]);
        
        const colorBuffer = device.createBuffer({
            size: colorData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        device.queue.writeBuffer(colorBuffer, 0, colorData);
        
        return device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{
                binding: 0,
                resource: { buffer: colorBuffer }
            }]
        });
    }

    // =================================================================
    // 4. ZEICHNEN (RENDER PASS)
    // =================================================================
    const encoder: GPUCommandEncoder = device.createCommandEncoder();

    const pass: GPURenderPassEncoder = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.1, g: 0.2, b: 0.1, a: 1.0 }, 
            loadOp: "clear",
            storeOp: "store",
        }]
    });

// =================================================================
    // 4. ZEICHNEN (RENDER LOOP / FRAME ARCHITEKTUR)
    // =================================================================
    
    // Materialien generieren
    const redMaterial = createMaterial(1.0, 0.0, 0.0, 1.0);
    const greenMaterial = createMaterial(0.0, 1.0, 0.0, 1.0);
    const blueMaterial = createMaterial(0.0, 0.0, 1.0, 1.0);

    // Wir bauen eine Funktion, die genau EIN Bild (Frame) zeichnet
    function drawFrame(materialToDraw: GPUBindGroup) {
        // 1. Frischer Zettel für dieses Bild
        const encoder: GPUCommandEncoder = device.createCommandEncoder();

        // 2. Render Pass starten (Löscht das alte Bild weg!)
        const pass: GPURenderPassEncoder = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0.1, g: 0.2, b: 0.1, a: 1.0 }, 
                loadOp: "clear",
                storeOp: "store",
            }]
        });

        // 3. Befehle aufschreiben
        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer); 
        pass.setBindGroup(0, materialToDraw); // Hier setzen wir die gewünschte Farbe ein
        pass.draw(vertexCount);
        
        pass.end();

        // 4. Zettel abgeben
        device.queue.submit([encoder.finish()]); 
    }

    // --- DIE ZEITSTEUERUNG ---
    
    // Sofort beim Start: Zeichne Rot
    drawFrame(redMaterial);

    // Nach 1000 Millisekunden (1 Sekunde): Zeichne Blau
    setTimeout(() => {
        drawFrame(blueMaterial);
    }, 1000);

    // Nach 2000 Millisekunden (2 Sekunden): Zeichne Grün
    setTimeout(() => {
        drawFrame(greenMaterial);
    }, 2000);
}

initWebGPU();