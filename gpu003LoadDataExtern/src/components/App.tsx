import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { GlobeRenderer } from '../webgpu/GlobeRenderer';
import { fetchWeatherData } from '../services/dataService';

/**
 * App Component: Main React component managing the WebGPU globe renderer.
 * 
 * Lifecycle:
 *   - On mount: Initialize canvas, create GlobeRenderer, start animation loop
 *   - On unmount: Stop animation and cleanup all resources (event listeners, GPU buffers)
 * 
 * React Integration Highlights:
 *   - useRef for stable canvas reference across renders
 *   - useEffect with proper cleanup function for lifecycle management
 *   - rendererRef maintains reference to renderer across renders
 */
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

    // Initialize renderer
    (async () => {
      try {
        renderer = new GlobeRenderer(canvas);
        await renderer.init();
        renderer.start();
        rendererRef.current = renderer;
        setIsLoading(false);
        await loadDataForLayer('wind');
      } catch (err) {
        console.error('WebGPU initialization error:', err);
        setIsLoading(false);
      }
    })();

    // Cleanup function: Called on unmount
    return () => {
      if (renderer) {
        // This calls inputController.cleanup() internally
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
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 1,
          background: '#111',
          color: '#fff',
          padding: 12,
          borderRadius: 8,
        }}
      >
        <label htmlFor="layer-select" style={{ marginRight: 8 }}>
          Layer:
        </label>
        <select id="layer-select" value={activeLayer} onChange={handleLayerChange}>
          <option value="wind">Wind</option>
          <option value="temperature">Temperature</option>
          <option value="humidity">Humidity</option>
        </select>
        {isLoading && <div style={{ marginTop: 8 }}>Loading data…</div>}
      </div>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
