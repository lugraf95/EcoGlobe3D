import { shaderCode } from './shader';
import { InputController } from './InputController';

type LayerMeshes = {
  earth: Float32Array;
  clouds: Float32Array;
};

/**
 * FrameData Uniform Structure (48 bytes / 12 floats)
 * MUST match the shader.ts struct definition exactly!
 * 
 * Layout (in order):
 *   time:        f32  (4 bytes)  - elapsed time in seconds
 *   isCloud:     f32  (4 bytes)  - 0.0 for earth, 1.0 for clouds
 *   rotX:        f32  (4 bytes)  - X-axis rotation (pitch)
 *   rotY:        f32  (4 bytes)  - Y-axis rotation (yaw)
 *   zoom:        f32  (4 bytes)  - zoom level (1.0 = default)
 *   aspectRatio: f32  (4 bytes)  - canvas width / canvas height
 *   sunDirX:     f32  (4 bytes)  - sun direction X component
 *   sunDirY:     f32  (4 bytes)  - sun direction Y component
 *   sunDirZ:     f32  (4 bytes)  - sun direction Z component
 *   pad1:        f32  (4 bytes)  - padding for 48-byte alignment
 *   pad2:        f32  (4 bytes)  - padding for 48-byte alignment
 *   pad3:        f32  (4 bytes)  - padding for 48-byte alignment
 * 
 * Total: 12 floats × 4 bytes = 48 bytes
 */
interface FrameData {
  time: number;
  isCloud: number;
  rotX: number;
  rotY: number;
  zoom: number;
  aspectRatio: number;
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
}

export class GlobeRenderer {
  private canvas: HTMLCanvasElement;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private depthTexture!: GPUTexture;
  private earthBG!: GPUBindGroup;
  private cloudBG!: GPUBindGroup;
  private earthBuf!: GPUBuffer;
  private cloudBuf!: GPUBuffer;
  private earthTimeBuf!: GPUBuffer;
  private cloudTimeBuf!: GPUBuffer;
  private layers!: LayerMeshes;
  private animationFrameId = 0;
  private inputController!: InputController;
  private format!: GPUTextureFormat;

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

  private async loadAllGLBLayers(url: string): Promise<LayerMeshes> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const dataView = new DataView(arrayBuffer);
    const jsonChunkLength = dataView.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonChunkLength)));
    const binOffset = 20 + jsonChunkLength + 8;

    const getTypedArray = (accessorId: number) => {
      const acc = json.accessors[accessorId];
      const view = json.bufferViews[acc.bufferView];
      const offset = binOffset + (view.byteOffset || 0) + (acc.byteOffset || 0);
      if (acc.componentType === 5123) return new Uint16Array(arrayBuffer, offset, acc.count);
      if (acc.componentType === 5125) return new Uint32Array(arrayBuffer, offset, acc.count);
      return new Float32Array(arrayBuffer, offset, acc.count * 3);
    };

    const processMesh = (meshName: string) => {
      const mesh = json.meshes.find((m: { name: string }) => m.name === meshName) || json.meshes[0];
      const prim = mesh.primitives[0];
      const pos = getTypedArray(prim.attributes.POSITION) as Float32Array;
      const indices = getTypedArray(prim.indices) as Uint16Array | Uint32Array;
      const data = new Float32Array(indices.length * 3);
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        data[i * 3] = pos[idx * 3];
        data[i * 3 + 1] = pos[idx * 3 + 1];
        data[i * 3 + 2] = pos[idx * 3 + 2];
      }
      return data;
    };

    return {
      earth: processMesh('Sphere'),
      clouds: processMesh('Sphere.001'),
    };
  }

  /**
   * Convert FrameData interface to Float32Array (12 floats = 48 bytes)
   * Order MUST match shader.ts struct definition
   */
  private frameDataToBuffer(frame: FrameData): Float32Array {
    return new Float32Array([
      frame.time,        // [0]
      frame.isCloud,     // [1]
      frame.rotX,        // [2]
      frame.rotY,        // [3]
      frame.zoom,        // [4]
      frame.aspectRatio, // [5]
      frame.sunDirX,     // [6]
      frame.sunDirY,     // [7]
      frame.sunDirZ,     // [8]
      0.0,               // [9] padding
      0.0,               // [10] padding
      0.0,               // [11] padding
    ]);
  }

  public async init() {
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter found');
    this.device = await adapter.requestDevice({
      requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
    });
    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    // Initialize InputController for mouse/wheel interactions
    this.inputController = new InputController(this.canvas);

    this.layers = await this.loadAllGLBLayers('/earth.glb');
    const earthTex = await this.loadTexture('/Color_Map.jpg');
    const cloudTex = await this.loadTexture('/Clouds.png');
    const nightTex = await this.loadTexture('/Night_Lights.jpg');

    const sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat' });

    // Create uniform buffers (48 bytes each = 12 floats for FrameData)
    this.earthTimeBuf = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.cloudTimeBuf = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const createBuf = (data: Float32Array) => {
      const buf = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(buf, 0, data);
      return buf;
    };

    this.earthBuf = createBuf(this.layers.earth);
    this.cloudBuf = createBuf(this.layers.clouds);

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.device.createShaderModule({ code: shaderCode }),
        entryPoint: 'vertexMain',
        buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
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
      ],
    });

    this.cloudBG = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: cloudTex.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: this.cloudTimeBuf } },
        { binding: 3, resource: cloudTex.createView() },
      ],
    });

    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  public start() {
    const render = (now: number) => {
      const time = now / 1000.0;
      const encoder = this.device.createCommandEncoder();
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

      pass.setPipeline(this.pipeline);

      // Read current input state
      const rotX = this.inputController.rotX;
      const rotY = this.inputController.rotY;
      const zoom = this.inputController.zoom;
      const aspectRatio = this.canvas.width / this.canvas.height;
      const globalRotY = rotY + (time * 0.02);
      const cloudRotY = rotY + (time * 0.03);

      // Sun direction
      const sunDirX = 0.67;
      const sunDirY = 0.0;
      const sunDirZ = 0.13;

      // Prepare earth frame data
      const earthFrame: FrameData = {
        time,
        isCloud: 0.0,
        rotX,
        rotY: globalRotY,
        zoom,
        aspectRatio,
        sunDirX,
        sunDirY,
        sunDirZ,
      };

      this.device.queue.writeBuffer(this.earthTimeBuf, 0, this.frameDataToBuffer(earthFrame));
      pass.setVertexBuffer(0, this.earthBuf);
      pass.setBindGroup(0, this.earthBG);
      pass.draw(this.layers.earth.length / 3);

      // Prepare cloud frame data
      const cloudFrame: FrameData = {
        time,
        isCloud: 1.0,
        rotX,
        rotY: cloudRotY,
        zoom,
        aspectRatio,
        sunDirX,
        sunDirY,
        sunDirZ,
      };

      this.device.queue.writeBuffer(this.cloudTimeBuf, 0, this.frameDataToBuffer(cloudFrame));
      pass.setVertexBuffer(0, this.cloudBuf);
      pass.setBindGroup(0, this.cloudBG);
      pass.draw(this.layers.clouds.length / 3);

      pass.end();
      this.device.queue.submit([encoder.finish()]);
      this.animationFrameId = requestAnimationFrame(render);
    };
    this.animationFrameId = requestAnimationFrame(render);
  }

  /**
   * Stop the animation loop and cleanup input controller.
   * Call this when unmounting the React component.
   */
  public stop() {
    cancelAnimationFrame(this.animationFrameId);
    // Clean up input event listeners
    this.inputController.cleanup();
  }

  public updateLayerData(layerType: string, bufferData: Float32Array) {
    console.log(`[WebGPU] Renderer received new data for ${layerType}!`, bufferData.length);
  }
}
