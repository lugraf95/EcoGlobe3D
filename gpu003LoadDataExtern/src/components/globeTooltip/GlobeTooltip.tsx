import { useEffect, useState, type RefObject } from 'react';
import { GlobeRenderer } from '../../webgpu/GlobeRenderer';
import type {GridData} from '../../services/dataService';

import './GlobeTooltip.css';

interface GlobeTooltipProps {
    canvasRef: RefObject<HTMLCanvasElement | null>;
    rendererRef: RefObject<GlobeRenderer | null>;
    activeLayer: string;
    currentData: GridData | null;
}

interface TooltipState {
    x: number;
    y: number;
    text: string;
}

export function GlobeTooltip({ canvasRef, rendererRef, activeLayer, currentData }: GlobeTooltipProps) {
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleCanvasClick = (e: MouseEvent) => {
            // Abbrechen, wenn keine Daten da sind oder der Standard-Modus aktiv ist
            if (
                !rendererRef.current ||
                !currentData ||
                currentData.cols === 0 ||
                activeLayer === 'normal'
            ) {
                setTooltip(null);
                return;
            }

            const coords = rendererRef.current.getLatLonFromScreen(e.clientX, e.clientY);
            if (!coords) {
                setTooltip(null);
                return;
            }

            const maxRows = Math.floor(180 / currentData.latStep);
            let latIdx = Math.round((90 - coords.lat) / currentData.latStep);
            let lonIdx = Math.round((coords.lon + 180) / currentData.lonStep);

            latIdx = Math.max(0, Math.min(latIdx, maxRows));
            lonIdx = Math.max(0, Math.min(lonIdx, currentData.cols - 1));

            const pointIndex = (latIdx * currentData.cols + lonIdx) * 8;

            if (pointIndex >= currentData.buffer.length) return;

            // Text generieren
            let valueText = `Breite.: ${coords.lat.toFixed(1)}°, Länge.: ${coords.lon.toFixed(1)}°\n`;

            if (activeLayer === 'temperature') {
                const temp = currentData.buffer[pointIndex + 2];
                valueText += `Temperatur: ${temp.toFixed(1)} °C`;
            } else if (activeLayer === 'wind') {
                const u = currentData.buffer[pointIndex + 3];
                const v = currentData.buffer[pointIndex + 4];
                const speed = Math.sqrt(u * u + v * v);
                valueText += `Windgeschw.: ${speed.toFixed(1)} km/h`;
            } else if (activeLayer === 'air_quality') {
                const aqi = currentData.buffer[pointIndex + 5];
                valueText += `Luftqualität (AQI): ${Math.round(aqi)}`;
            }

            setTooltip({
                x: e.clientX,
                y: e.clientY,
                text: valueText
            });
        };

        canvas.addEventListener('click', handleCanvasClick);
        setTooltip(null);

        return () => {
            canvas.removeEventListener('click', handleCanvasClick);
        };
    }, [canvasRef, rendererRef, activeLayer, currentData]);

    if (!tooltip) return null;

    return (
        <div
            className="globe-tooltip"
            style={{
                left: tooltip.x + 15,
                top: tooltip.y + 15
            }}
        >
            {tooltip.text}
        </div>
    );
}