import './Legend.scss';

interface LegendProps {
    activeLayer: string;
}

const LEGEND_CONFIGS: Record<string, any> = {
    temperature: {
        title: 'Temperatur (°C)',
        type: 'gradient',
        gradientClass: 'temperature-gradient',
        labels: ['> 35°C', '25°C', '10°C', '-10°C', '< -10°C']
    },
    air_quality: {
        title: 'Luftqualität (AQI)',
        type: 'gradient',
        gradientClass: 'aqi-gradient',
        labels: ['> 200 (Sehr schlecht)', '150 (Schlecht)', '100 (Mäßig)', '50 (Gut)', '0']
    },
    wind: {
        title: 'Windtempo (km/h)',
        type: 'animation',
        gradientClass: '',
        labels: ['> 118 km/h (Orkan)', '75 - 117 km/h (Sturm)', '39 - 74 km/h (Stark)', '12 - 38 km/h (Mäßig)', '< 12 km/h (Ruhig)']
    }
};

/**
 * Zeigt die Legende passend zur aktuell ausgewählten Datenschicht an.
 * Wird im Standard-Ansichtsmodus (Fotorealismus) ausgeblendet.
 */
export function Legend({ activeLayer }: LegendProps) {
    if (activeLayer === 'normal' || !LEGEND_CONFIGS[activeLayer]) {
        return null;
    }

    const currentLegendData = LEGEND_CONFIGS[activeLayer];

    return (
        <div className={`legend-container ${activeLayer}`}>
            <h3 className="legend-title">{currentLegendData.title}</h3>
            <div className="legend-content">
                {currentLegendData.type === 'animation' ? (
                    <div className="wind-indicator-wrapper">
                        <div className="wind-zone wind-zone-fast" title="Sturm / Orkan"></div>
                        <div className="wind-zone wind-zone-medium" title="Mäßiger bis starker Wind"></div>
                        <div className="wind-zone wind-zone-slow" title="Schwach / Windstill"></div>
                    </div>
                ) : (
                    <div className={`legend-gradient ${currentLegendData.gradientClass}`}></div>
                )}

                {/* Text-Labels neben dem Farbverlauf oder der Animation */}
                <div className="legend-labels">
                    {currentLegendData.labels.map((label: string, index: number) => (
                        <span key={index} className="legend-label-item">{label}</span>
                    ))}
                </div>
            </div>
        </div>
    );
}