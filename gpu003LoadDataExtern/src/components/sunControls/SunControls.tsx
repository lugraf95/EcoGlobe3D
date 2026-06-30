import { useState, useEffect, type RefObject } from 'react';
import { GlobeRenderer } from '../../webgpu/GlobeRenderer';
import './SunControls.css';

interface SunControlsProps {
    rendererRef: RefObject<GlobeRenderer | null>;
}

export function SunControls({ rendererRef }: SunControlsProps) {
    // Initialwerte entsprechend deinem bisherigen Hardcoding im Renderer
    const [x, setX] = useState<number>(0.37);
    const [y, setY] = useState<number>(0.80);
    const [z, setZ] = useState<number>(0.83);

    // Synchronisation mit dem WebGPU-Renderer bei jeder Slider-Bewegung
    useEffect(() => {
        if (rendererRef.current) {
            rendererRef.current.setSunDirection(x, y, z);
        }
    }, [x, y, z, rendererRef]);

    return (
        <div className="sun-controls-panel">
            <h3 className="sun-controls-title">Sonnenstand (Licht)</h3>

            <div className="slider-group">
                <div className="slider-label">
                    <span>X-Achse (Links/Rechts)</span>
                    <span>{x.toFixed(2)}</span>
                </div>
                <input
                    type="range" min="-1.0" max="1.0" step="0.01"
                    value={x} onChange={(e) => setX(parseFloat(e.target.value))}
                    className="slider-input"
                />
            </div>

            <div className="slider-group">
                <div className="slider-label">
                    <span>Y-Achse (Oben/Unten)</span>
                    <span>{y.toFixed(2)}</span>
                </div>
                <input
                    type="range" min="-1.0" max="1.0" step="0.01"
                    value={y} onChange={(e) => setY(parseFloat(e.target.value))}
                    className="slider-input"
                />
            </div>

            <div className="slider-group">
                <div className="slider-label">
                    <span>Z-Achse (Tiefe)</span>
                    <span>{z.toFixed(2)}</span>
                </div>
                <input
                    type="range" min="-1.0" max="1.0" step="0.01"
                    value={z} onChange={(e) => setZ(parseFloat(e.target.value))}
                    className="slider-input"
                />
            </div>
        </div>
    );
}