import { InputController } from './InputController';
import { GlobeRenderer } from './GlobeRenderer';

const canvas = document.querySelector<HTMLCanvasElement>("#testWebGPU")!;

// --- DEINE ALTEN HILFSFUNKTIONEN (Unverändert) ---
async function loadTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
    const img = new Image(); img.src = url; await img.decode();
    const imageBitmap = await createImageBitmap(img);
    const texture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height, 1],
        format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture }, [imageBitmap.width, imageBitmap.height]);
    return texture;
}

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

// --- SETUP ---
async function bootstrap() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice({ requiredLimits: { maxTextureDimension2D: adapter!.limits.maxTextureDimension2D } });
    const context = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    // 1. Controller & Renderer instanziieren
    const input = new InputController(canvas);
    const renderer = new GlobeRenderer(device, context, format, input);

    // 2. Button-Logik verbinden
    document.getElementById('btn-normal')?.addEventListener('click', () => renderer.currentMode = 'NORMAL');
    document.getElementById('btn-temp')?.addEventListener('click', () => renderer.currentMode = 'TEMPERATURE');
    document.getElementById('btn-wind')?.addEventListener('click', () => renderer.currentMode = 'WIND');

    // 3. Daten laden
    const layers = await loadAllGLBLayers('/earth.glb');
    const earthTex = await loadTexture(device, '/Color_Map.jpg');
    const cloudTex = await loadTexture(device, '/Clouds.png');
    const nightTex = await loadTexture(device, '/Night_Lights.jpg');

    // 4. Renderer finalisieren (WICHTIG: Das await verhindert den "Argument 1 is not an object" Fehler!)
    await renderer.init(layers, earthTex, cloudTex, nightTex);

    // 5. Render Loop
    function loop(now: number) {
        renderer.render(now / 1000.0);
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

bootstrap().catch(console.error);