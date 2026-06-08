import { useEffect, useRef, useState } from 'react';
import { GlobeRenderer } from '../webgpu/GlobeRenderer';
import { fetchWeatherData } from '../services/dataService';

import { LayerDropdown } from './layerDropdown/LayerDropdown.tsx';
import './App.css';
import {LoadingSpinner} from "./loadingSpinner/LoadingSpinner.tsx";

export function App() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<GlobeRenderer | null>(null);
    const [activeLayer, setActiveLayer] = useState<string>('normal');
    const [isLoading, setIsLoading] = useState<boolean>(true);

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
                setIsLoading(false);
                await loadDataForLayer(activeLayer);
            } catch (err) {
                console.error('WebGPU initialization error:', err);
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        })();

        return () => {
            isMounted = false;
            if (renderer) {
                renderer.stop();
            }
        };
    }, []);

    const handleLayerChange = (newLayer: string) => {
        setActiveLayer(newLayer);
        void loadDataForLayer(newLayer);
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