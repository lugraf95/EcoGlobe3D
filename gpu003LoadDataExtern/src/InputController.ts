export class InputController {
    public rotX: number = 0.0;
    public rotY: number = 0.0;
    public zoom: number = 1.0;

    private isDragging: boolean = false;
    private previousMouse: { x: number, y: number } = { x: 0, y: 0 };

    constructor(canvas: HTMLCanvasElement) {
        // WICHTIG: Verhindert, dass der Browser beim Ziehen scrollt oder markiert
        canvas.style.touchAction = 'none'; 

        canvas.addEventListener('pointerdown', (e) => {
            this.isDragging = true;
            this.previousMouse = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId); // Hält den Cursor "fest"
        });

        // InputController.ts
        canvas.addEventListener('pointermove', (e) => {
            if (!this.isDragging) return;
            
            // Berechne nur die Änderung seit dem letzten Frame
            const deltaX = e.clientX - this.previousMouse.x;
            const deltaY = e.clientY - this.previousMouse.y;

            // Nur bei tatsächlicher Bewegung anpassen
            this.rotY += deltaX * 0.01; // Etwas direkter
            this.rotX += deltaY * 0.01;

            // Limitieren
            const maxPitch = Math.PI / 2 - 0.05;
            this.rotX = Math.max(-maxPitch, Math.min(maxPitch, this.rotX));

            this.previousMouse = { x: e.clientX, y: e.clientY };
        });

        canvas.addEventListener('pointerup', (e) => {
            this.isDragging = false;
            canvas.releasePointerCapture(e.pointerId);
        });

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoom += e.deltaY * 0.001;
            this.zoom = Math.max(0.5, Math.min(this.zoom, 2.5));
        }, { passive: false });
    }
}   