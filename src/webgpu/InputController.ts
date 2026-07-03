export class InputController {
    public rotX: number = 0.0;
    public rotY: number = 0.0;
    public zoom: number = 1.0;

    private readonly canvas: HTMLCanvasElement;
    private isDragging: boolean = false;
    private lastPointerPosition: { x: number; y: number } = { x: 0, y: 0 };

    private pointerDownHandler: ((event: PointerEvent) => void) | null = null;
    private pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
    private pointerUpHandler: ((event: PointerEvent) => void) | null = null;
    private wheelHandler: ((event: WheelEvent) => void) | null = null;

    /** Initialisiert die Eingabesteuerung für das Canvas. */
    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.setupEventListeners();
    }

    /** Entfernt alle Event-Listener und setzt den Zustand zurück. */
    public cleanup() {
        this.removePointerListener('pointerdown', this.pointerDownHandler);
        this.removePointerListener('pointermove', this.pointerMoveHandler);
        this.removePointerListener('pointerup', this.pointerUpHandler);
        this.removeWheelListener();

        this.isDragging = false;
    }

    /** Registriert die Event-Listener für Drag und Zoom. */
    private setupEventListeners() {
        this.canvas.style.touchAction = 'none';

        this.pointerDownHandler = (event: PointerEvent) => this.handlePointerDown(event);
        this.pointerMoveHandler = (event: PointerEvent) => this.handlePointerMove(event);
        this.pointerUpHandler = (event: PointerEvent) => this.handlePointerUp(event);
        this.wheelHandler = (event: WheelEvent) => this.handleWheel(event);

        this.canvas.addEventListener('pointerdown', this.pointerDownHandler);
        this.canvas.addEventListener('pointermove', this.pointerMoveHandler);
        this.canvas.addEventListener('pointerup', this.pointerUpHandler);
        this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    }

    /** Beginnt einen Drag-Vorgang und merkt sich die Startposition. */
    private handlePointerDown(event: PointerEvent) {
        this.isDragging = true;
        this.lastPointerPosition = { x: event.clientX, y: event.clientY };
        this.canvas.setPointerCapture(event.pointerId);
    }

    /** Aktualisiert Rotation und begrenzt die Neigung auf einen sicheren Bereich. */
    private handlePointerMove(event: PointerEvent) {
        if (!this.isDragging) return;

        const deltaX = event.clientX - this.lastPointerPosition.x;
        const deltaY = event.clientY - this.lastPointerPosition.y;

        this.rotY += deltaX * 0.01;
        this.rotX += deltaY * 0.01;
        this.rotX = this.clampPitch(this.rotX);

        this.lastPointerPosition = { x: event.clientX, y: event.clientY };
    }

    /** Beendet den Drag-Vorgang und gibt den Pointer wieder frei. */
    private handlePointerUp(event: PointerEvent) {
        this.isDragging = false;
        this.canvas.releasePointerCapture(event.pointerId);
    }

    /** Passt den Zoom weich an und hält ihn innerhalb der erlaubten Grenzen. */
    private handleWheel(event: WheelEvent) {
        event.preventDefault();

        const minZoom = 0.5;
        const maxZoom = 3.5;
        const damping = 1.5;
        let zoomDelta = -(event.deltaY * 0.001);

        if (zoomDelta > 0) {
            zoomDelta *= (maxZoom - this.zoom) * damping;
        } else {
            zoomDelta *= (this.zoom - minZoom) * damping;
        }

        this.zoom = this.clampValue(this.zoom + zoomDelta, minZoom, maxZoom);
    }

    /** Begrenzt die vertikale Rotation, damit die Ansicht nicht kippt. */
    private clampPitch(value: number): number {
        const maxPitch = Math.PI / 2 - 0.05;
        return Math.max(-maxPitch, Math.min(maxPitch, value));
    }

    /** Begrenzt einen Wert auf einen definierten Bereich. */
    private clampValue(value: number, minValue: number, maxValue: number): number {
        return Math.max(minValue, Math.min(value, maxValue));
    }

    /** Entfernt einen Pointer-Listener nur dann, wenn er registriert wurde. */
    private removePointerListener(
        type: 'pointerdown' | 'pointermove' | 'pointerup',
        handler: ((event: PointerEvent) => void) | null,
    ) {
        if (!handler) return;

        this.canvas.removeEventListener(type, handler);

        if (type === 'pointerdown') this.pointerDownHandler = null;
        if (type === 'pointermove') this.pointerMoveHandler = null;
        if (type === 'pointerup') this.pointerUpHandler = null;
    }

    /** Entfernt den Wheel-Listener, wenn er registriert wurde. */
    private removeWheelListener() {
        if (!this.wheelHandler) return;

        this.canvas.removeEventListener('wheel', this.wheelHandler as unknown as EventListener);
        this.wheelHandler = null;
    }
}
