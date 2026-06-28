import { InputController } from './InputController';
import { shaderCode } from './shader';
// Importiere die neuen Shader (stelle sicher, dass die Dateinamen passen!)
import { particleComputeShader } from './particleCompute.wgsl';
import { particleRenderShader } from './particleRender.wgsl';

interface FrameData {
    time: number; isCloud: number; rotX: number; rotY: number; zoom: number; aspectRatio: number;
    sunDirX: number; sunDirY: number; sunDirZ: number; weatherMode: number; weatherPointCount: number;
    gridWidth: number;
    latStep: number;
    lonStep: number;
}

export class GlobeRenderer {
  private gridWidth = 0;
  private latStep = 0;
  private lonStep = 0;

  private static readonly MAX_WEATHER_POINTS = 65536;
  private readonly PARTICLE_COUNT = 10000; // Anzahl der Partikel
  
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

  // --- NEU: Partikel-System Variablen ---
  private particleBuffer!: GPUBuffer;
  private particleComputePipeline!: GPUComputePipeline;
  private particleRenderPipeline!: GPURenderPipeline;
  private particleComputeBindGroup!: GPUBindGroup; // Für den Compute-Shader
  private particleRenderBindGroup!: GPUBindGroup;  // Für den Render-Shader
  // --------------------------------------

  private animationFrameId = 0;
  private inputController!: InputController;
  private format!: GPUTextureFormat;
  private weatherPointCount = 0;
  private weatherMode = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
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

    private frameDataToBuffer(frame: FrameData): Float32Array {
        return new Float32Array([
            frame.time, frame.isCloud, frame.rotX, frame.rotY,
            frame.zoom, frame.aspectRatio, frame.sunDirX, frame.sunDirY,
            frame.sunDirZ, frame.weatherMode, frame.weatherPointCount,
            frame.gridWidth, frame.latStep, frame.lonStep, 0.0, 0.0
        ]);
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

      this.earthTimeBuf = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.cloudTimeBuf = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    
    this.weatherBuf = this.device.createBuffer({
      size: GlobeRenderer.MAX_WEATHER_POINTS * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const sphereData = this.createSphere(1.0, 64, 64);
    
    this.vertexBuf = this.device.createBuffer({ size: sphereData.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.vertexBuf, 0, sphereData.vertices);
    
    this.indexBuf = this.device.createBuffer({ size: sphereData.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.indexBuf, 0, sphereData.indices);
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
        targets: [
          {
            format: this.format,
            blend: {
              color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
            },
          },
        ],
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

    // --- NEU: Initialisiere das Partikel-System ---
    await this.initParticleSystem();
  }

  // --- NEU: Partikel Pipeline Setup ---
  private async initParticleSystem() {
    // 32 Bytes pro Partikel (2x vec4<f32>)
    this.particleBuffer = this.device.createBuffer({
      size: this.PARTICLE_COUNT * 32, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

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
        // Additive Blending fuer leuchtende Stroeme
        targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one' }, alpha: {} } }]
      },
      primitive: { topology: 'line-list' },
      depthStencil: { depthWriteEnabled: false, depthCompare: 'less-equal', format: 'depth24plus' }
    });

    // NEU: Separate BindGroup für den Compute Shader
    this.particleComputeBindGroup = this.device.createBindGroup({
      layout: this.particleComputePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.earthTimeBuf } },
        { binding: 1, resource: { buffer: this.weatherBuf } },
        { binding: 2, resource: { buffer: this.particleBuffer } }
      ]
    });

    // NEU: Separate BindGroup für den Render Shader (braucht kein weatherBuf auf Binding 1)
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
      const encoder = this.device.createCommandEncoder();
      
      const rotX = this.inputController.rotX;
      const rotY = this.inputController.rotY;
      const zoom = this.inputController.zoom;
      const aspectRatio = this.canvas.width / this.canvas.height;
      const globalRotY = rotY + (time * 0.02);
      const cloudRotY = rotY + (time * 0.03);

        const earthFrame: FrameData = {
            time, isCloud: 0.0, rotX, rotY: globalRotY, zoom, aspectRatio,
            sunDirX: 0.37, sunDirY: 0.8, sunDirZ: 0.83,
            weatherMode: this.weatherMode, weatherPointCount: this.weatherPointCount,
            gridWidth: this.gridWidth, latStep: this.latStep, lonStep: this.lonStep
        };
      this.device.queue.writeBuffer(this.earthTimeBuf, 0, this.frameDataToBuffer(earthFrame));

      // --- NEU 1. COMPUTE PASS (Physik vor dem Rendern berechnen) ---
      if (this.weatherMode === 2) {
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.particleComputePipeline);
        // Korrekte BindGroup setzen
        computePass.setBindGroup(0, this.particleComputeBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(this.PARTICLE_COUNT / 64));
        computePass.end();
      }

      // --- 2. RENDER PASS (Grafik) ---
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.context.getCurrentTexture().createView(),
            clearValue: { r: 0.01, g: 0.01, b: 0.05, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: this.depthTexture.createView(),
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });

      // A: Erde zeichnen
      pass.setPipeline(this.pipeline);
      pass.setVertexBuffer(0, this.vertexBuf);
      pass.setIndexBuffer(this.indexBuf, 'uint32');
      pass.setBindGroup(0, this.earthBG);
      pass.drawIndexed(this.indexCount);

      // B: Wolken zeichnen (Nur im "Normal"-Modus)
      if (this.weatherMode === 0) {
        const cloudFrame = { ...earthFrame, isCloud: 1.0, rotY: cloudRotY };
        this.device.queue.writeBuffer(this.cloudTimeBuf, 0, this.frameDataToBuffer(cloudFrame));
        pass.setBindGroup(0, this.cloudBG);
        pass.drawIndexed(this.indexCount);
      }

      // --- NEU C: Partikel zeichnen ---
      if (this.weatherMode === 2) {
        pass.setPipeline(this.particleRenderPipeline);
        // Korrekte BindGroup setzen
        pass.setBindGroup(0, this.particleRenderBindGroup);
        pass.draw(2, this.PARTICLE_COUNT, 0, 0); // 2 Vertices pro Linie
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
        this.weatherMode = layerType === 'temperature' ? 1 : layerType === 'wind' ? 2 : 0;
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
}