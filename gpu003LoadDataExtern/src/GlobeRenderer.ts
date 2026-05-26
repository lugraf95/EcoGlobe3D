import { shaderCode } from "./shader.wgsl";
import { InputController } from "./InputController";

export type VisualizationMode = 'NORMAL' | 'TEMPERATURE' | 'WIND';

export class GlobeRenderer {
    private device: GPUDevice;
    private context: GPUCanvasContext;
    private format: GPUTextureFormat;
    private input: InputController;

    public currentMode: VisualizationMode = 'NORMAL';

    private pipeline!: GPURenderPipeline;
    private depthTexture!: GPUTexture;
    private earthTimeBuf!: GPUBuffer;
    private cloudTimeBuf!: GPUBuffer;
    private earthBuf!: GPUBuffer;
    private cloudBuf!: GPUBuffer;
    private earthBG!: GPUBindGroup;
    private cloudBG!: GPUBindGroup;
    
    private numEarthVertices: number = 0;
    private numCloudVertices: number = 0;

    constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat, input: InputController) {
        this.device = device;
        this.context = context;
        this.format = format;
        this.input = input;
    }

    public init(layers: any, earthTex: GPUTexture, cloudTex: GPUTexture, nightTex: GPUTexture) {
        const sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat' });

        // WICHTIG: Hier exakt 32 Bytes (8 Floats)
        this.earthTimeBuf = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.cloudTimeBuf = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        const createBuf = (data: Float32Array) => {
            const buf = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
            this.device.queue.writeBuffer(buf, 0, data);
            return buf;
        };

        this.earthBuf = createBuf(layers.earth);
        this.cloudBuf = createBuf(layers.clouds);
        this.numEarthVertices = layers.earth.length / 3;
        this.numCloudVertices = layers.clouds.length / 3;

        this.pipeline = this.device.createRenderPipeline({
            layout: "auto",
            vertex: {
                module: this.device.createShaderModule({ code: shaderCode }),
                entryPoint: "vertexMain",
                buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }]
            },
            fragment: {
                module: this.device.createShaderModule({ code: shaderCode }),
                entryPoint: "fragmentMain",
                targets: [{ 
                    format: this.format, 
                    blend: {
                        color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                        alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }
                    }
                }]
            },
            primitive: { topology: "triangle-list", cullMode: "back" },
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less-equal', format: 'depth24plus' }
        });

        this.earthBG = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: earthTex.createView() },
                { binding: 1, resource: sampler },
                { binding: 2, resource: { buffer: this.earthTimeBuf } },
                { binding: 3, resource: nightTex.createView() }
            ]
        });

        this.cloudBG = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: cloudTex.createView() },
                { binding: 1, resource: sampler },
                { binding: 2, resource: { buffer: this.cloudTimeBuf } },
                { binding: 3, resource: cloudTex.createView() }
            ]
        });

        this.depthTexture = this.device.createTexture({
            size: [this.context.canvas.width, this.context.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
    }

    public render(timeSec: number) {
        const encoder = this.device.createCommandEncoder();
        
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.01, g: 0.01, b: 0.05, a: 1.0 },
                loadOp: "clear", storeOp: "store",
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store'
            }
        });

const sunDirX = 0.67; const sunDirY = 0.0; const sunDirZ = 0.13;
        const globalRotY = this.input.rotY + (timeSec * 0.02);
        
        // Aktuelles Aspect Ratio berechnen (passt sich beim Resize an!)
        const aspectRatio = this.context.canvas.width / this.context.canvas.height;

        if (this.currentMode === 'NORMAL') {
            pass.setPipeline(this.pipeline);

            // Exakt 12 Werte (48 Bytes) passend zur neuen WGSL Struktur
            const earthUniforms = new Float32Array([
                timeSec, 0.0, this.input.rotX, globalRotY, this.input.zoom, aspectRatio, sunDirX, sunDirY, sunDirZ, 0, 0, 0
            ]);
            this.device.queue.writeBuffer(this.earthTimeBuf, 0, earthUniforms);
            pass.setVertexBuffer(0, this.earthBuf);
            pass.setBindGroup(0, this.earthBG);
            pass.draw(this.numEarthVertices);

            const cloudRotY = this.input.rotY + (timeSec * 0.03);
            
            const cloudUniforms = new Float32Array([
                timeSec, 1.0, this.input.rotX, cloudRotY, this.input.zoom, aspectRatio, sunDirX, sunDirY, sunDirZ, 0, 0, 0
            ]);
            this.device.queue.writeBuffer(this.cloudTimeBuf, 0, cloudUniforms);
            pass.setVertexBuffer(0, this.cloudBuf);
            pass.setBindGroup(0, this.cloudBG);
            pass.draw(this.numCloudVertices);
            
        } else if (this.currentMode === 'TEMPERATURE') {
            // --- STUB: TEMPERATUR ZEICHNEN ---
        } else if (this.currentMode === 'WIND') {
            // --- STUB: WIND ZEICHNEN ---
        }

        pass.end();
        this.device.queue.submit([encoder.finish()]);
    }
}