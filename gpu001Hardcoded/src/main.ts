import { shaderCode } from "./shader";
// Den Chef anweisen, das Schaufenster aus dem HTML zu suchen
const canvas = document.querySelector<HTMLCanvasElement>("#testWebGPU");




async function initWebGPU() {
    if (!navigator.gpu) {
        throw new Error("WebGPU wird von diesem Browser nicht unterstützt.");
    }
    if (!canvas) {
    throw new Error("Canvas element not found.");
    }
    
    // Die Grafikkarte (Adapter) anfragen
    const adapter: GPUAdapter | null = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Kein passender Adapter gefunden.");

    // Die logische Schnittstelle (Device) erstellen
    const device: GPUDevice = await adapter.requestDevice();

    // Das Schaufenster (Context) einrichten
    const context = canvas.getContext("webgpu") as unknown as GPUCanvasContext;
    const format: GPUTextureFormat = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device: device,
        format: format,
        alphaMode: "opaque"
    });

    console.log("WebGPU erfolgreich mit TypeScript initialisiert!");
    // 1. Die Betriebsanleitung (WGSL) an die GPU übergeben
    const shaderModule = device.createShaderModule({
        code: shaderCode
    });

    // 2. Das Fließband (Pipeline) fest zusammenschweißen
    const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: shaderModule,
            entryPoint: "vertexMain" // Unser Architekt
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain", // Unser Maler
            targets: [{ format: format }]
        },
        primitive: {
            topology: "triangle-list"
        }
    });

    // 3. Den Einkaufszettel (Encoder) ausfüllen
    const encoder: GPUCommandEncoder = device.createCommandEncoder();

    // Wir machen den Hintergrund dunkelgrau, damit das Dreieck gut sichtbar ist
    const pass: GPURenderPassEncoder = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 }, 
            loadOp: "clear",
            storeOp: "store",
        }]
    });

    // 4. Die Befehle aufschreiben
    pass.setPipeline(pipeline); // Nutzt das Fließband!
    pass.draw(3);               // Zeichne 3 Eckpunkte!
    pass.end();

    // 5. Zettel abschließen und abschicken!
    const commandBuffer: GPUCommandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]); 
}

initWebGPU();