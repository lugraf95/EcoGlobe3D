import { useState, useEffect, type RefObject } from 'react';
import { GlobeRenderer } from '../../webgpu/GlobeRenderer';
import './SunControls.scss';

interface SunControlsProps {
    rendererRef: RefObject<GlobeRenderer | null>;
}

/**
 * Steuert den simulierten Sonnenstand für den WebGPU-Renderer.
 * Bietet Slider für die X-, Y- und Z-Achse an.
 */
export function SunControls({ rendererRef }: SunControlsProps) {
    const [sunCoordinates, setSunCoordinates] = useState({ x: 0.37, y: 0.80, z: 0.83 });

    /**
     * Synchronisiert den lokalen State mit dem WebGPU-Renderer.
     * Wird bei jeder Änderung eines Sliders aufgerufen.
     */
    useEffect(() => {
        if (rendererRef.current) {
            rendererRef.current.setSunDirection(sunCoordinates.x, sunCoordinates.y, sunCoordinates.z);
        }
    }, [sunCoordinates, rendererRef]);

    /**
     * Aktualisiert eine spezifische Koordinaten-Achse basierend auf dem Slider-Input.
     */
    const updateCoordinate = (axis: keyof typeof sunCoordinates, value: string) => {
        setSunCoordinates(prev => ({ ...prev, [axis]: parseFloat(value) }));
    };

    const sliderConfigs = [
        { axis: 'x' as const, label: 'X-Achse (Links/Rechts)' },
        { axis: 'y' as const, label: 'Y-Achse (Oben/Unten)' },
        { axis: 'z' as const, label: 'Z-Achse (Tiefe)' }
    ];

    return (
        <div className="sun-controls-panel">
            <h3 className="sun-controls-title">Sonnenstand (Licht)</h3>

            {sliderConfigs.map(({ axis, label }) => (
                <div className="slider-group" key={axis}>
                    <div className="slider-label">
                        <span>{label}</span>
                        <span>{sunCoordinates[axis].toFixed(2)}</span>
                    </div>
                    <input
                        type="range" min="-1.0" max="1.0" step="0.01"
                        value={sunCoordinates[axis]}
                        onChange={(e) => updateCoordinate(axis, e.target.value)}
                        className="slider-input"
                    />
                </div>
            ))}
        </div>
    );
}