export type ClimateLayer = 'normal' | 'temperature' | 'wind' | 'air_quality';

const API_BASE_URL = 'https://api.open-meteo.com/v1/forecast';

const TARGET_POINTS = 300;
const CHUNK_SIZE = 150;
const CONCURRENT_REQUESTS = 1;

export interface GridData {
    buffer: Float32Array;
    cols: number;
    latStep: number;
    lonStep: number;
}

let cachedGlobalWeatherBuffer: GridData | null = null;
let isFetchingWeather = false;
let fetchWeatherPromise: Promise<GridData> | null = null;

/**
 * Generiert ein gleichmäßiges, dynamisches Raster von Geokoordinaten und initialisiert den Datenspeicher.
 * Berechnet die Anzahl der Reihen und Spalten basierend auf der Zielpunktzahl für den gesamten Globus
 * in einem 2:1-Seitenverhältnis (360° Länge / 180° Breite).
 * * @param targetPoints - Die angestrebte Gesamtanzahl der Rasterpunkte.
 * @returns Ein Objekt bestehend aus dem vorinitialisierten Float32Array (Memory Layout Stride 8),
 * einem Array zur Zuordnung von API-Koordinaten zum Buffer-Index sowie den Rasterdimensionen.
 */
function createDynamicGrid(targetPoints: number) {
    const rows = Math.max(1, Math.round(Math.sqrt(targetPoints / 2)));
    const cols = Math.round(targetPoints / rows);

    const latStep = 180 / rows;
    const lonStep = 360 / cols;

    const buffer = new Float32Array((rows + 1) * cols * 8);
    const coordinates = [];

    let offset = 0;
    for (let i = 0; i <= rows; i++) {
        const lat = 90 - i * latStep;
        for (let j = 0; j < cols; j++) {
            const lon = -180 + j * lonStep;
            coordinates.push({ lat, lon, index: offset });

            buffer[offset] = lat;
            buffer[offset + 1] = lon;
            buffer[offset + 2] = 0.0;
            buffer[offset + 3] = 0.0;
            buffer[offset + 4] = 0.0;

            offset += 8;
        }
    }
    return { buffer, coordinates, cols, latStep, lonStep };
}

/**
 * Lädt globale Wetter- und Luftqualitätsdaten asynchron über die Open-Meteo API herunter.
 * Teilt das generierte Raster in kleinere Chunks auf, um HTTP-URL-Längenlimits der API zu respektieren.
 * Die abgerufenen Metriken (Temperatur, Windvektoren, AQI) werden anhand des Mappings
 * direkt an die richtigen Offsets in das zugrundeliegende Float32Array geschrieben.
 * * @returns Ein Promise, das zu den vollständig befüllten Rasterdaten (Buffer und Metadaten) auflöst.
 */
async function performGlobalWeatherDownload(): Promise<GridData> {
    const { buffer, coordinates, cols, latStep, lonStep } = createDynamicGrid(TARGET_POINTS);

    const chunks = [];
    for (let i = 0; i < coordinates.length; i += CHUNK_SIZE) {
        chunks.push(coordinates.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i += CONCURRENT_REQUESTS) {
        const batch = chunks.slice(i, i + CONCURRENT_REQUESTS);

        await Promise.all(
            batch.map(async (chunk) => {
                const latString = chunk.map((c) => c.lat.toFixed(2)).join(',');
                const lonString = chunk.map((c) => c.lon.toFixed(2)).join(',');

                const weatherUrl = `${API_BASE_URL}?latitude=${latString}&longitude=${lonString}&current=temperature_2m,wind_u_component_10m,wind_v_component_10m`;
                const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latString}&longitude=${lonString}&current=us_aqi`;

                try {
                    const [weatherRes, aqiRes] = await Promise.all([
                        fetch(weatherUrl),
                        fetch(aqiUrl),
                    ]);

                    const weatherData = await weatherRes.json();
                    const aqiData = await aqiRes.json();

                    const weatherArray = Array.isArray(weatherData) ? weatherData : [weatherData];
                    const aqiArray = Array.isArray(aqiData) ? aqiData : [aqiData];

                    for (let j = 0; j < chunk.length; j++) {
                        const baseIdx = chunk[j].index;

                        buffer[baseIdx + 2] = weatherArray[j]?.current?.temperature_2m ?? 0.0;
                        buffer[baseIdx + 3] = weatherArray[j]?.current?.wind_u_component_10m ?? 0.0;
                        buffer[baseIdx + 4] = weatherArray[j]?.current?.wind_v_component_10m ?? 0.0;
                        buffer[baseIdx + 5] = aqiArray[j]?.current?.us_aqi ?? 0.0;
                    }
                } catch (error) {
                    console.error(`[API] Fetch-Fehler bei Chunk:`, error);
                }
            }),
        );
    }

    console.log('[API] Scan abgeschlossen!');
    return { buffer, cols, latStep, lonStep };
}

/**
 * Öffentlicher Einstiegspunkt für den Abruf der Klimadaten.
 * Implementiert einen Singleton/Caching-Mechanismus, um redundante API-Aufrufe zu verhindern.
 * Parallele Aufrufe dieser Methode während eines noch laufenden Downloads
 * werden gebündelt und warten auf denselben Fetch-Vorgang (Promise-Deduplizierung).
 * * @param layerType - Der Name der angeforderten Visualisierungsebene. Bei 'normal' werden keine Daten abgerufen.
 * @returns Ein Promise, das das geladene oder gecachte Float32Array nebst Raster-Metadaten zurückgibt.
 */
export async function fetchWeatherData(layerType: string): Promise<GridData> {
    if (layerType === 'normal') {
        return { buffer: new Float32Array(0), cols: 0, latStep: 0, lonStep: 0 };
    }

    if (cachedGlobalWeatherBuffer) return cachedGlobalWeatherBuffer;
    if (isFetchingWeather && fetchWeatherPromise) return await fetchWeatherPromise;

    isFetchingWeather = true;
    fetchWeatherPromise = performGlobalWeatherDownload();

    try {
        cachedGlobalWeatherBuffer = await fetchWeatherPromise;
    } finally {
        isFetchingWeather = false;
        fetchWeatherPromise = null;
    }

    return cachedGlobalWeatherBuffer;
}