import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { GlobeRenderer } from '../webgpu/GlobeRenderer';
import { fetchWeatherData } from '../services/dataService';

import { LayerDropdown } from './LayerDropdown';
import './App.css';

export function App() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<GlobeRenderer | null>(null);
    const [activeLayer, setActiveLayer] = useState<string>('wind');
    const [isLoading, setIsLoading] = useState<boolean>(true);

    const loadDataForLayer = async (layer: string) => {
        setIsLoading(true);
        const dataBuffer = await fetchWeatherData(layer);
        if (rendererRef.current) {
            rendererRef.current.updateLayerData(layer, dataBuffer);
        }
        setIsLoading(false);
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
                await loadDataForLayer('wind');
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

    const handleLayerChange = (e: ChangeEvent<HTMLSelectElement>) => {
        const newLayer = e.target.value;
        setActiveLayer(newLayer);
        void loadDataForLayer(newLayer);
    };

    return (
        <div className="app-container">
            <LayerDropdown
                activeLayer={activeLayer}
                isLoading={isLoading}
                onLayerChange={handleLayerChange}
            />

            <canvas ref={canvasRef} className="globe-canvas" />
        </div>
    );
}