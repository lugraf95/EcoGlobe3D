import { useEffect, useState, type RefObject } from 'react';
import { GlobeRenderer } from '../../webgpu/GlobeRenderer';
import type { GridData } from '../../services/dataService';

import './GlobeTooltip.scss';

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

/**
 * Zeigt beim Klick auf den Globus einen Tooltip mit spezifischen Messwerten an.
 * Berechnet die geographischen Koordinaten aus dem Klick-Event.
 */
export function GlobeTooltip({
    canvasRef,
    rendererRef,
    activeLayer,
    currentData,
}: GlobeTooltipProps) {
    const [tooltipState, setTooltipState] = useState<TooltipState | null>(null);

    /**
     * Fügt den Klick-Listener zum Canvas hinzu und verarbeitet die Koordinaten.
     */
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleCanvasClick = (event: MouseEvent) => {
            // Abbruchbedingung: Keine Daten vorhanden oder Standard-Layer aktiv
            if (
                !rendererRef.current ||
                !currentData ||
                currentData.cols === 0 ||
                activeLayer === 'normal'
            ) {
                setTooltipState(null);
                return;
            }

            const coordinates = rendererRef.current.getLatLonFromScreen(
                event.clientX,
                event.clientY,
            );
            if (!coordinates) {
                setTooltipState(null);
                return;
            }

            const maxRows = Math.floor(180 / currentData.latStep);
            let latIndex = Math.round((90 - coordinates.lat) / currentData.latStep);
            let lonIndex = Math.round((coordinates.lon + 180) / currentData.lonStep);

            // Beschränkung der Indizes auf die Grid-Grenzen
            latIndex = Math.max(0, Math.min(latIndex, maxRows));
            lonIndex = Math.max(0, Math.min(lonIndex, currentData.cols - 1));

            const pointIndex = (latIndex * currentData.cols + lonIndex) * 8;
            if (pointIndex >= currentData.buffer.length) return;

            let tooltipText = `Breite.: ${coordinates.lat.toFixed(1)}°, Länge.: ${coordinates.lon.toFixed(1)}°\n`;

            const textGenerators: Record<string, () => string> = {
                temperature: () =>
                    `Temperatur: ${currentData.buffer[pointIndex + 2].toFixed(1)} °C`,
                wind: () => {
                    const u = currentData.buffer[pointIndex + 3];
                    const v = currentData.buffer[pointIndex + 4];
                    return `Windgeschw.: ${Math.sqrt(u * u + v * v).toFixed(1)} km/h`;
                },
                air_quality: () =>
                    `Luftqualität (AQI): ${Math.round(currentData.buffer[pointIndex + 5])}`,
            };

            if (textGenerators[activeLayer]) {
                tooltipText += textGenerators[activeLayer]();
            }

            setTooltipState({
                x: event.clientX,
                y: event.clientY,
                text: tooltipText,
            });
        };

        canvas.addEventListener('click', handleCanvasClick);
        setTooltipState(null);

        return () => {
            canvas.removeEventListener('click', handleCanvasClick);
        };
    }, [canvasRef, rendererRef, activeLayer, currentData]);

    if (!tooltipState) return null;

    return (
        <div
            className="globe-tooltip"
            style={{
                left: tooltipState.x + 15,
                top: tooltipState.y + 15,
            }}
        >
            {tooltipState.text}
        </div>
    );
}
