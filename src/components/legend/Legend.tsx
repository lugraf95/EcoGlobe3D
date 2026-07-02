import './Legend.css';

interface LegendProps {
    activeLayer: string;
}

const LEGEND_DATA: Record<string, any> = {
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

export function Legend({ activeLayer }: LegendProps) {
    if (activeLayer === 'normal' || !LEGEND_DATA[activeLayer]) {
        return null;
    }

    const data = LEGEND_DATA[activeLayer];

    return (
        <div className={`legend-container ${activeLayer}`}>
            <h3 className="legend-title">{data.title}</h3>
            <div className="legend-content">
                {data.type === 'animation' ? (
                    <div className="wind-indicator-wrapper">
                        <div className="wind-zone wind-zone-fast" title="Sturm / Orkan"></div>
                        <div className="wind-zone wind-zone-medium" title="Mäßiger bis starker Wind"></div>
                        <div className="wind-zone wind-zone-slow" title="Schwach / Windstill"></div>
                    </div>
                ) : (
                    <div className={`legend-gradient ${data.gradientClass}`}></div>
                )}
                <div className="legend-labels">
                    {data.labels.map((label: string, index: number) => (
                        <span key={index} className="legend-label-item">{label}</span>
                    ))}
                </div>
            </div>
        </div>
    );
}