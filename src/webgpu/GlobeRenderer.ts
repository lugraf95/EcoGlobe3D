import { InputController } from './InputController';
import { shaderCode } from './shader';
import { particleComputeShader } from './particleCompute.wgsl';
import { particleRenderShader } from './particleRender.wgsl';

export class GlobeRenderer {
    private gridWidth = 0;
    private latStep = 0;
    private lonStep = 0;

    // Sonnenrichtung
    private sunDirX = 0.37;
    private sunDirY = 0.8;
    private sunDirZ = 0.83;

    public setSunDirection(x: number, y: number, z: number) {
        this.sunDirX = x;
        this.sunDirY = y;
        this.sunDirZ = z;
    }

    private static readonly MAX_WEATHER_POINTS = 65536;
    private readonly PARTICLE_COUNT = 10000;

    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private pipeline!: GPURenderPipeline;
    private depthTexture!: GPUTexture;
    private earthBG!: GPUBindGroup;
    private cloudBG!: GPUBindGroup;

    private vertexBuf!: GPUBuffer;
    private indexBuf!: GPUBuffer;
    private indexCount: number = 0;

    private earthTimeBuf!: GPUBuffer;
    private cloudTimeBuf!: GPUBuffer;
    private weatherBuf!: GPUBuffer;

    private currentTime: number = 0;

    // Partikel-System
    private particleBuffer!: GPUBuffer;
    private particleComputePipeline!: GPUComputePipeline;
    private particleRenderPipeline!: GPURenderPipeline;
    private particleComputeBindGroup!: GPUBindGroup;
    private particleRenderBindGroup!: GPUBindGroup;

    private animationFrameId = 0;
    private inputController!: InputController;
    private format!: GPUTextureFormat;
    private weatherPointCount = 0;
    private weatherMode = 0;

    // Einmalig allokierter Speicher für die Uniforms, verhindert Garbage Collection Ruckler!
    private uniformData = new Float32Array(16);

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    // Hilfsmethode, die das Erstellen und Befüllen von Buffern deutlich verkürzt
    private createBuffer(size: number, usage: number, data?: Float32Array | Uint32Array): GPUBuffer {
        const buffer = this.device.createBuffer({ size, usage });
        if (data) {
            this.device.queue.writeBuffer(buffer, 0, data);
        }
        return buffer;
    }

    // Überschreibt nur die Werte im bereits existierenden Speicher (Performance-Boost)
    private updateUniforms(time: number, isCloud: number, rotX: number, rotY: number, zoom: number, aspectRatio: number): Float32Array {
        this.uniformData[0] = time;
        this.uniformData[1] = isCloud;
        this.uniformData[2] = rotX;
        this.uniformData[3] = rotY;
        this.uniformData[4] = zoom;
        this.uniformData[5] = aspectRatio;
        this.uniformData[6] = this.sunDirX;
        this.uniformData[7] = this.sunDirY;
        this.uniformData[8] = this.sunDirZ;
        this.uniformData[9] = this.weatherMode;
        this.uniformData[10] = this.weatherPointCount;
        this.uniformData[11] = this.gridWidth;
        this.uniformData[12] = this.latStep;
        this.uniformData[13] = this.lonStep;
        this.uniformData[14] = 0.0; // Padding
        this.uniformData[15] = 0.0; // Padding
        return this.uniformData;
    }

    private async loadTexture(url: string): Promise<GPUTexture> {
        const img = new Image();
        img.src = url;
        await img.decode();
        const imageBitmap = await createImageBitmap(img);
        const texture = this.device.createTexture({
            size: [imageBitmap.width, imageBitmap.height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture },
            [imageBitmap.width, imageBitmap.height],
        );
        return texture;
    }

    private createSphere(radius: number, widthSegments: number, heightSegments: number) {
        const vertices = [];
        const indices = [];

        for (let y = 0; y <= heightSegments; y++) {
            const v = y / heightSegments;
            const phi = v * Math.PI;

            for (let x = 0; x <= widthSegments; x++) {
                const u = x / widthSegments;
                const theta = u * Math.PI * 2;

                const px = -radius * Math.cos(theta) * Math.sin(phi);
                const py = radius * Math.cos(phi);
                const pz = radius * Math.sin(theta) * Math.sin(phi);

                const nx = px / radius;
                const ny = py / radius;
                const nz = pz / radius;

                vertices.push(px, py, pz, 1.0, nx, ny, nz, 0.0, u, v);
            }
        }

        for (let y = 0; y < heightSegments; y++) {
            for (let x = 0; x < widthSegments; x++) {
                const first = (y * (widthSegments + 1)) + x;
                const second = first + widthSegments + 1;

                indices.push(first, second, first + 1);
                indices.push(second, second + 1, first + 1);
            }
        }

        return {
            vertices: new Float32Array(vertices),
            indices: new Uint32Array(indices)
        };
    }

    public async init() {
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('No WebGPU adapter found');
        this.device = await adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

        this.inputController = new InputController(this.canvas);

        const earthTex = await this.loadTexture('/Color_Map.jpg');
        const cloudTex = await this.loadTexture('/Clouds.png');
        const nightTex = await this.loadTexture('/Night_Lights.jpg');

        const sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat' });

        this.earthTimeBuf = this.createBuffer(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this.cloudTimeBuf = this.createBuffer(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

        this.weatherBuf = this.createBuffer(
            GlobeRenderer.MAX_WEATHER_POINTS * 32,
            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        );

        const sphereData = this.createSphere(1.0, 64, 64);
        this.vertexBuf = this.createBuffer(sphereData.vertices.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, sphereData.vertices);
        this.indexBuf = this.createBuffer(sphereData.indices.byteLength, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, sphereData.indices);
        this.indexCount = sphereData.indices.length;

        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: this.device.createShaderModule({ code: shaderCode }),
                entryPoint: 'vertexMain',
                buffers: [{
                    arrayStride: 40,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x4' },
                        { shaderLocation: 1, offset: 16, format: 'float32x4' },
                        { shaderLocation: 2, offset: 32, format: 'float32x2' }
                    ]
                }],
            },
            fragment: {
                module: this.device.createShaderModule({ code: shaderCode }),
                entryPoint: 'fragmentMain',
                targets: [{
                    format: this.format,
                    blend: {
                        color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                        alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
                    },
                }],
            },
            primitive: { topology: 'triangle-list', cullMode: 'back' },
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less-equal', format: 'depth24plus' },
        });

        this.earthBG = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: earthTex.createView() },
                { binding: 1, resource: sampler },
                { binding: 2, resource: { buffer: this.earthTimeBuf } },
                { binding: 3, resource: nightTex.createView() },
                { binding: 4, resource: { buffer: this.weatherBuf } },
            ],
        });

        this.cloudBG = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: cloudTex.createView() },
                { binding: 1, resource: sampler },
                { binding: 2, resource: { buffer: this.cloudTimeBuf } },
                { binding: 3, resource: cloudTex.createView() },
                { binding: 4, resource: { buffer: this.weatherBuf } },
            ],
        });

        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        await this.initParticleSystem();
    }

    private async initParticleSystem() {
        this.particleBuffer = this.createBuffer(
            this.PARTICLE_COUNT * 32,
            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        );

        const computeModule = this.device.createShaderModule({ code: particleComputeShader });
        this.particleComputePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: computeModule, entryPoint: 'computeMain' }
        });

        const renderModule = this.device.createShaderModule({ code: particleRenderShader });
        this.particleRenderPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: renderModule, entryPoint: 'vertexMain' },
            fragment: {
                module: renderModule, entryPoint: 'fragmentMain',
                targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one' }, alpha: {} } }]
            },
            primitive: { topology: 'line-list' },
            depthStencil: { depthWriteEnabled: false, depthCompare: 'less-equal', format: 'depth24plus' }
        });

        this.particleComputeBindGroup = this.device.createBindGroup({
            layout: this.particleComputePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.earthTimeBuf } },
                { binding: 1, resource: { buffer: this.weatherBuf } },
                { binding: 2, resource: { buffer: this.particleBuffer } }
            ]
        });

        this.particleRenderBindGroup = this.device.createBindGroup({
            layout: this.particleRenderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.earthTimeBuf } },
                { binding: 2, resource: { buffer: this.particleBuffer } }
            ]
        });
    }

    public start() {
        const render = (now: number) => {
            const time = now / 1000.0;
            this.currentTime = time;
            const encoder = this.device.createCommandEncoder();

            const rotX = this.inputController.rotX;
            const globalRotY = this.inputController.rotY + (time * 0.02);
            const cloudRotY = this.inputController.rotY + (time * 0.03);
            const zoom = this.inputController.zoom;
            const aspectRatio = this.canvas.width / this.canvas.height;

            const earthData = this.updateUniforms(time, 0.0, rotX, globalRotY, zoom, aspectRatio);
            this.device.queue.writeBuffer(this.earthTimeBuf, 0, earthData);

            // 1. COMPUTE PASS
            if (this.weatherMode === 2) {
                const computePass = encoder.beginComputePass();
                computePass.setPipeline(this.particleComputePipeline);
                computePass.setBindGroup(0, this.particleComputeBindGroup);
                computePass.dispatchWorkgroups(Math.ceil(this.PARTICLE_COUNT / 64));
                computePass.end();
            }

            // 2. RENDER PASS
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: this.context.getCurrentTexture().createView(),
                    clearValue: { r: 0.01, g: 0.01, b: 0.05, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
                depthStencilAttachment: {
                    view: this.depthTexture.createView(),
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            });

            pass.setPipeline(this.pipeline);
            pass.setVertexBuffer(0, this.vertexBuf);
            pass.setIndexBuffer(this.indexBuf, 'uint32');

            // A: Erde zeichnen
            pass.setBindGroup(0, this.earthBG);
            pass.drawIndexed(this.indexCount);

            // B: Wolken zeichnen
            if (this.weatherMode === 0) {
                const cloudData = this.updateUniforms(time, 1.0, rotX, cloudRotY, zoom, aspectRatio);
                this.device.queue.writeBuffer(this.cloudTimeBuf, 0, cloudData);
                pass.setBindGroup(0, this.cloudBG);
                pass.drawIndexed(this.indexCount);
            }

            // C: Partikel zeichnen
            if (this.weatherMode === 2) {
                pass.setPipeline(this.particleRenderPipeline);
                pass.setBindGroup(0, this.particleRenderBindGroup);
                pass.draw(2, this.PARTICLE_COUNT, 0, 0);
            }

            pass.end();
            this.device.queue.submit([encoder.finish()]);
            this.animationFrameId = requestAnimationFrame(render);
        };
        this.animationFrameId = requestAnimationFrame(render);
    }

    public stop() {
        cancelAnimationFrame(this.animationFrameId);
        if (this.inputController) {
            this.inputController.cleanup();
        }
    }

    public updateLayerData(layerType: string, bufferData: Float32Array, gridWidth = 0, latStep = 0, lonStep = 0) {
        this.weatherMode = layerType === 'temperature' ? 1 : layerType === 'wind' ? 2 : layerType === 'air_quality' ? 3 : 0;
        this.weatherPointCount = Math.min(Math.floor(bufferData.length / 8), GlobeRenderer.MAX_WEATHER_POINTS);

        this.gridWidth = gridWidth;
        this.latStep = latStep;
        this.lonStep = lonStep;

        if (this.weatherPointCount > 0) {
            const uploadLength = this.weatherPointCount * 8;
            const uploadData = uploadLength === bufferData.length ? bufferData : bufferData.subarray(0, uploadLength);
            this.device.queue.writeBuffer(this.weatherBuf, 0, uploadData);
        }
    }

    public getLatLonFromScreen(clientX: number, clientY: number): { lat: number, lon: number } | null {
        if (!this.inputController) return null;

        const rect = this.canvas.getBoundingClientRect();
        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
        const aspectRatio = rect.width / rect.height;

        const rotX = this.inputController.rotX;
        const globalRotY = this.inputController.rotY + (this.currentTime * 0.02);
        const scale = 0.6 * this.inputController.zoom;

        const rotatedX = (ndcX * aspectRatio) / scale;
        const rotatedY = ndcY / scale;

        const radiusSq = rotatedX * rotatedX + rotatedY * rotatedY;
        if (radiusSq > 1.0) return null;

        const rotatedZ = Math.sqrt(1.0 - radiusSq);

        const sx = Math.sin(-rotX), cx = Math.cos(-rotX);
        const y1 = rotatedY * cx - rotatedZ * sx;
        const z1 = rotatedY * sx + rotatedZ * cx;

        const sy = Math.sin(-globalRotY), cy = Math.cos(-globalRotY);
        const origX = rotatedX * cy + z1 * sy;
        const origY = y1;
        const origZ = -rotatedX * sy + z1 * cy;

        const lat = Math.asin(origY) * (180 / Math.PI);

        let theta = Math.atan2(origZ, -origX);
        if (theta < 0) theta += 2 * Math.PI;

        const lon = (theta / (2 * Math.PI) * 360.0) - 180.0;

        return { lat, lon };
    }
}