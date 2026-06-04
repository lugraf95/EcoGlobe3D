import { useState } from 'react';
import { Globe, Thermometer, Wind, Lightbulb, Sliders, ChevronUp, ChevronDown } from 'lucide-react';
import './LayerDropdown.css';

interface LayerDropdownProps {
    activeLayer: string;
    onLayerChange: (layerId: string) => void;
}

type ClimateLayer = 'normal' | 'temperature' | 'wind' | 'light';

export function LayerDropdown({ activeLayer, onLayerChange }: LayerDropdownProps) {
    const [isLayersExpanded, setIsLayersExpanded] = useState(true);

    const layers = [
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
            id: 'light' as ClimateLayer,
            name: 'Lichtverschmutzung',
            icon: Lightbulb,
            desc: 'Verschmutzung der Dunkelheit durch insbesondere künstliche Lichtquellen.',
        }
    ];

    const activeLayerInfo = layers.find(l => l.id === activeLayer) || layers[0];

    return (
        <div className="control-panel-aside">
            <div className="collapsible-layers">

                {/* Toggle Header */}
                <button
                    onClick={() => setIsLayersExpanded(!isLayersExpanded)}
                    className="toggle-header"
                >
                    <div className="header-left">
                        <Sliders size={13} style={{ color: '#34d399' }} />
                        <span className="header-title">Messdaten</span>
                    </div>
                    <div className="header-right">
                        <span className="active-badge">{activeLayerInfo.name}</span>
                        {isLayersExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                </button>

                {/* Aufklappbarer Body */}
                <div className={`layers-body ${isLayersExpanded ? 'expanded' : 'collapsed'}`}>
                    {layers.map((l) => {
                        const Icon = l.icon;
                        const isSelected = activeLayer === l.id;

                        return (
                            <button
                                key={l.id}
                                onClick={() => onLayerChange(l.id)}
                                className={`layer-btn ${l.id} ${isSelected ? 'active' : ''}`}
                            >
                                <div className="icon-wrapper">
                                    <Icon size={14} />
                                </div>
                                <div className="layer-text-content">
                                    <span className="layer-name">{l.name}</span>
                                    <span className="layer-desc">{l.desc}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>

            </div>
        </div>
    );
}