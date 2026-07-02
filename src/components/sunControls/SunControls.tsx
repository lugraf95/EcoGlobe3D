import { useState, useEffect, type RefObject } from 'react';
import { GlobeRenderer } from '../../webgpu/GlobeRenderer';
import './SunControls.css';

interface SunControlsProps {
    rendererRef: RefObject<GlobeRenderer | null>;
}

export function SunControls({ rendererRef }: SunControlsProps) {
    const [coords, setCoords] = useState({ x: 0.37, y: 0.80, z: 0.83 });

    useEffect(() => {
        if (rendererRef.current) {
            rendererRef.current.setSunDirection(coords.x, coords.y, coords.z);
        }
    }, [coords, rendererRef]);

    const updateCoord = (axis: keyof typeof coords, value: string) => {
        setCoords(prev => ({ ...prev, [axis]: parseFloat(value) }));
    };

    const sliders = [
        { axis: 'x' as const, label: 'X-Achse (Links/Rechts)' },
        { axis: 'y' as const, label: 'Y-Achse (Oben/Unten)' },
        { axis: 'z' as const, label: 'Z-Achse (Tiefe)' }
    ];

    return (
        <div className="sun-controls-panel">
            <h3 className="sun-controls-title">Sonnenstand (Licht)</h3>

            {sliders.map(({ axis, label }) => (
                <div className="slider-group" key={axis}>
                    <div className="slider-label">
                        <span>{label}</span>
                        <span>{coords[axis].toFixed(2)}</span>
                    </div>
                    <input
                        type="range" min="-1.0" max="1.0" step="0.01"
                        value={coords[axis]}
                        onChange={(e) => updateCoord(axis, e.target.value)}
                        className="slider-input"
                    />
                </div>
            ))}
        </div>
    );
}