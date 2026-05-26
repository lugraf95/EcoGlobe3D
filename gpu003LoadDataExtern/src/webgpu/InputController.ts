/**
 * InputController
 * 
 * Handles pointer and wheel input on a canvas element.
 * Manages rotation (rotX, rotY) and zoom state.
 * 
 * IMPORTANT: Call cleanup() when done to remove event listeners and prevent memory leaks.
 */
export class InputController {
  public rotX: number = 0.0;
  public rotY: number = 0.0;
  public zoom: number = 1.0;

  private isDragging: boolean = false;
  private previousMouse: { x: number; y: number } = { x: 0, y: 0 };
  private canvas: HTMLCanvasElement;

  // Store bound handlers so we can remove them later
  private pointerDownHandler: ((e: PointerEvent) => void) | null = null;
  private pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private pointerUpHandler: ((e: PointerEvent) => void) | null = null;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Prevent browser behavior on touch/pointer events
    this.canvas.style.touchAction = 'none';

    // Bind handlers so we can remove them later
    this.pointerDownHandler = (e: PointerEvent) => {
      this.isDragging = true;
      this.previousMouse = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    };

    this.pointerMoveHandler = (e: PointerEvent) => {
      if (!this.isDragging) return;

      const deltaX = e.clientX - this.previousMouse.x;
      const deltaY = e.clientY - this.previousMouse.y;

      this.rotY += deltaX * 0.01;
      this.rotX += deltaY * 0.01;

      // Clamp pitch to prevent gimbal lock
      const maxPitch = Math.PI / 2 - 0.05;
      this.rotX = Math.max(-maxPitch, Math.min(maxPitch, this.rotX));

      this.previousMouse = { x: e.clientX, y: e.clientY };
    };

    this.pointerUpHandler = (e: PointerEvent) => {
      this.isDragging = false;
      this.canvas.releasePointerCapture(e.pointerId);
    };

    this.wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      this.zoom += e.deltaY * 0.001;
      this.zoom = Math.max(0.5, Math.min(this.zoom, 2.5));
    };

    // Register event listeners
    this.canvas.addEventListener('pointerdown', this.pointerDownHandler);
    this.canvas.addEventListener('pointermove', this.pointerMoveHandler);
    this.canvas.addEventListener('pointerup', this.pointerUpHandler);
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
  }

  /**
   * Cleanup: Remove all event listeners to prevent memory leaks.
   * MUST be called when the component unmounts or the renderer is destroyed.
   */
  public cleanup() {
    if (this.pointerDownHandler) {
      this.canvas.removeEventListener('pointerdown', this.pointerDownHandler);
      this.pointerDownHandler = null;
    }
    if (this.pointerMoveHandler) {
      this.canvas.removeEventListener('pointermove', this.pointerMoveHandler);
      this.pointerMoveHandler = null;
    }
    if (this.pointerUpHandler) {
      this.canvas.removeEventListener('pointerup', this.pointerUpHandler);
      this.pointerUpHandler = null;
    }
    if (this.wheelHandler) {
      this.canvas.removeEventListener('wheel', this.wheelHandler);
      this.wheelHandler = null;
    }

    // Reset state
    this.isDragging = false;
  }
}
