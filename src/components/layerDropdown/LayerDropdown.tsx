import { useState } from 'react';
import { Globe, Thermometer, Wind, CloudFog, Sliders, ChevronUp, ChevronDown } from 'lucide-react';
import './LayerDropdown.scss';

interface LayerDropdownProps {
    activeLayer: string;
    onLayerChange: (layerId: string) => void;
}

type ClimateLayer = 'normal' | 'temperature' | 'wind' | 'air_quality';

const CLIMATE_LAYERS = [
    {
        id: 'normal' as ClimateLayer,
        name: 'Normale Ansicht',
        icon: Globe,
        desc: 'Fotorealistische 3D Konturen mit Ozeantiefen und Wolkenformationen.',
    },
    {
        id: 'temperature' as ClimateLayer,
        name: 'Temperatur',
        icon: Thermometer,
        desc: 'Globale Erwärmungsmuster von arktischen Polen bis zur Äquatorhitze.',
    },
    {
        id: 'wind' as ClimateLayer,
        name: 'Windströme',
        icon: Wind,
        desc: 'Echtzeit Windgeschwindigkeiten mit simulierten Wirbelstürmen über Meeren.',
    },
    {
        id: 'air_quality' as ClimateLayer,
        name: 'Luftqualität',
        icon: CloudFog,
        desc: 'Globale Luftqualität (AQI) und Feinstaubbelastung in Echtzeit.',
    }
];

/**
 * Dropdown-Menü zur Auswahl der verschiedenen Klimadaten-Schichten.
 * Ermöglicht das Umschalten zwischen Fotorealismus, Temperatur, Wind und AQI.
 */
export function LayerDropdown({ activeLayer, onLayerChange }: LayerDropdownProps) {
    const [isMenuExpanded, setIsMenuExpanded] = useState(true);

    const activeLayerInfo = CLIMATE_LAYERS.find(layer => layer.id === activeLayer) || CLIMATE_LAYERS[0];

    return (
        <div className="control-panel-aside">
            <div className="collapsible-layers">

                <button
                    onClick={() => setIsMenuExpanded(!isMenuExpanded)}
                    className="toggle-header"
                >
                    <div className="header-left">
                        <Sliders size={13} style={{ color: '#34d399' }} />
                        <span className="header-title">Messdaten</span>
                    </div>
                    <div className="header-right">
                        <span className="active-badge">{activeLayerInfo.name}</span>
                        {isMenuExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                </button>

                <div className={`layers-body ${isMenuExpanded ? 'expanded' : 'collapsed'}`}>
                    {CLIMATE_LAYERS.map((layer) => {
                        const Icon = layer.icon;
                        const isSelected = activeLayer === layer.id;

                        return (
                            <button
                                key={layer.id}
                                onClick={() => onLayerChange(layer.id)}
                                className={`layer-btn ${layer.id} ${isSelected ? 'active' : ''}`}
                                tabIndex={isMenuExpanded ? 0 : -1}
                            >
                                <div className="icon-wrapper">
                                    <Icon size={14} />
                                </div>
                                <div className="layer-text-content">
                                    <span className="layer-name">{layer.name}</span>
                                    <span className="layer-desc">{layer.desc}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}