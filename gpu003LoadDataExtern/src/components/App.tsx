import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GlobeRenderer } from '../webgpu/GlobeRenderer';
import { fetchWeatherData } from '../services/dataService';

import { LayerDropdown } from './layerDropdown/LayerDropdown.tsx';
import './App.css';
import { LoadingSpinner } from "./loadingSpinner/LoadingSpinner.tsx";

export function App() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<GlobeRenderer | null>(null);

    const { layerId } = useParams();
    const navigate = useNavigate();

    const validLayers = ['normal', 'temperature', 'wind', 'light'];

    const activeLayer = layerId || 'normal';

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isEngineReady, setIsEngineReady] = useState<boolean>(false);

    const loadDataForLayer = async (layer: string) => {
        setIsLoading(true);
        try {
            const dataBuffer = await fetchWeatherData(layer);
            if (rendererRef.current) {
                rendererRef.current.updateLayerData(layer, dataBuffer);
            }
        } catch (err) {
            console.error(`Failed to load data for layer "${layer}".`, err);
        } finally {
            setIsLoading(false);
        }
    };

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
            } catch (err) {
                console.error('WebGPU initialization error:', err);
                if (isMounted) setIsLoading(false);
            }
        })();

        return () => {
            isMounted = false;
            if (renderer) renderer.stop();
        };
    }, []);

    useEffect(() => {
        if (isEngineReady) {
            void loadDataForLayer(activeLayer);
        }
    }, [isEngineReady, activeLayer]);

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
            <LayerDropdown
                activeLayer={activeLayer}
                onLayerChange={handleLayerChange}
            />

            {isLoading && <LoadingSpinner />}
            <canvas ref={canvasRef} className="globe-canvas" />
        </div>
    );
}