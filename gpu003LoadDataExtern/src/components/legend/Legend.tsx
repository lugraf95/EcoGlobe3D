import './Legend.css';

interface LegendProps {
    activeLayer: string;
}

export function Legend({ activeLayer }: LegendProps) {
    // In der normalen Ansicht blenden wir die Legende komplett aus
    if (activeLayer === 'normal') {
        return null;
    }

    const getLegendData = () => {
        switch (activeLayer) {
            case 'temperature':
                return {
                    title: 'Temperatur (°C)',
                    gradientClass: 'temperature-gradient',
                    // Von oben (heiß) nach unten (kalt) sortiert
                    labels: ['> 35°C', '25°C', '10°C', '-10°C', '< -10°C']
                };
            case 'air_quality':
                return {
                    title: 'Luftqualität (AQI)',
                    gradientClass: 'aqi-gradient',
                    // Von oben (schlecht) nach unten (gut) sortiert
                    labels: ['> 200 (Sehr schlecht)', '150 (Schlecht)', '100 (Mäßig)', '50 (Gut)', '0']
                };
            case 'wind':
                return {
                    title: 'Windgeschwindigkeit',
                    gradientClass: 'wind-gradient',
                    // Von oben (stark) nach unten (schwach) sortiert
                    labels: ['Sturm / Orkan', 'Starker Wind', 'Mäßiger Wind', 'Leichter Zug', 'Windstill']
                };
            default:
                return null;
        }
    };

    const data = getLegendData();

    if (!data) return null;

    return (
        <div className="legend-container">
            <h3 className="legend-title">{data.title}</h3>
            <div className="legend-content">
                <div className={`legend-gradient ${data.gradientClass}`}></div>
                <div className="legend-labels">
                    {data.labels.map((label, index) => (
                        <span key={index} className="legend-label-item">{label}</span>
                    ))}
                </div>
            </div>
        </div>
    );
}