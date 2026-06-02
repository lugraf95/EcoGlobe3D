import type {ChangeEvent} from 'react';

interface LayerDropdownProps {
    activeLayer: string;
    isLoading: boolean;
    onLayerChange: (e: ChangeEvent<HTMLSelectElement>) => void;
}

export function LayerDropdown({ activeLayer, isLoading, onLayerChange }: LayerDropdownProps) {
    return (
        <div className="layer-control-panel">
            <label htmlFor="layer-select" className="layer-label">
                Layer:
            </label>
            <select id="layer-select" value={activeLayer} onChange={onLayerChange}>
                <option value="wind">Wind</option>
                <option value="temperature">Temperature</option>
                <option value="humidity">Humidity</option>
            </select>
            {isLoading && <div className="loading-indicator">Loading data…</div>}
        </div>
    );
}