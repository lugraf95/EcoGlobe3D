import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GlobeRenderer } from '../webgpu/GlobeRenderer';
import { fetchWeatherData, type GridData } from '../services/dataService';

import { LayerDropdown } from './layerDropdown/LayerDropdown.tsx';
import { LoadingSpinner } from './loadingSpinner/LoadingSpinner.tsx';
import { GlobeTooltip } from './globeTooltip/GlobeTooltip.tsx';
import { Legend } from './legend/Legend.tsx';
import { SunControls } from './sunControls/SunControls.tsx';
import './App.scss';

/**
 * Hauptkomponente der Anwendung.
 * Steuert das Routing, den globalen Zustand (Wetterdaten) und den WebGPU-Renderer.
 */
export function App() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<GlobeRenderer | null>(null);

    const { layerId } = useParams();
    const navigate = useNavigate();

    const validLayers = ['normal', 'temperature', 'wind', 'air_quality'];
    const activeLayer = layerId || 'normal';

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isEngineReady, setIsEngineReady] = useState<boolean>(false);
    const [currentData, setCurrentData] = useState<GridData | null>(null);

    /**
     * Lädt die spezifischen Wetterdaten für den ausgewählten Layer.
     * Aktualisiert anschließend den WebGPU-Renderer mit den neuen Daten.
     */
    const loadDataForLayer = async (layer: string) => {
        setIsLoading(true);
        try {
            const data = await fetchWeatherData(layer);
            setCurrentData(data);

            // Renderer aktualisieren, sobald Daten vorhanden sind
            if (rendererRef.current) {
                rendererRef.current.updateLayerData(
                    layer,
                    data.buffer,
                    data.cols,
                    data.latStep,
                    data.lonStep,
                );
            }
        } catch (error) {
            console.error(`Failed to load data for layer "${layer}".`, error);
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Initialisiert den WebGPU-Renderer einmalig beim Mounten der Komponente.
     * Kümmert sich auch um das Aufräumen (Stop) beim Unmount.
     */
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let renderer: GlobeRenderer | null = null;
        let isMounted = true;

        (async () => {
            try {
                renderer = new GlobeRenderer(canvas);
                await renderer.init();

                if (!isMounted) return;

                renderer.start();
                rendererRef.current = renderer;
                setIsEngineReady(true);
            } catch (error) {
                console.error('WebGPU initialization error:', error);
                if (isMounted) setIsLoading(false);
            }
        })();

        return () => {
            isMounted = false;
            if (renderer) renderer.stop();
        };
    }, []);

    /**
     * Reagiert auf Änderungen des aktiven Layers und lädt die passenden Daten nach.
     */
    useEffect(() => {
        if (isEngineReady) {
            void loadDataForLayer(activeLayer);
        }
    }, [isEngineReady, activeLayer]);

    /**
     * Validiert die URL-Parameter.
     * Leitet auf die Standardansicht weiter, falls ein ungültiger Layer aufgerufen wird.
     */
    useEffect(() => {
        if (layerId && !validLayers.includes(layerId)) {
            navigate(`/normal`, { replace: true });
        }
    }, [layerId, navigate]);

    const handleLayerChange = (newLayer: string) => {
        navigate(`/${newLayer}`);
    };

    return (
        <div className="app-container">
            <LayerDropdown activeLayer={activeLayer} onLayerChange={handleLayerChange} />

            {isLoading && <LoadingSpinner />}

            {/* 3D Globus Render-Fläche */}
            <canvas ref={canvasRef} className="globe-canvas" />

            <GlobeTooltip
                canvasRef={canvasRef}
                rendererRef={rendererRef}
                activeLayer={activeLayer}
                currentData={currentData}
            />

            <SunControls rendererRef={rendererRef} />
            <Legend activeLayer={activeLayer} />
        </div>
    );
}
