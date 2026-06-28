export type ClimateLayer = 'normal' | 'temperature' | 'wind' | 'light';

const API_BASE_URL = 'https://api.open-meteo.com/v1/forecast';

const TARGET_POINTS = 300; // <--- HIER DEINE GEWÜNSCHTE PUNKTZAHL EINTRAGEN
const CHUNK_SIZE = 150;    // Groß genug, damit 100 Punkte in exakt EINEN Request passen
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


function createDynamicGrid(targetPoints: number) {
    const rows = Math.max(1, Math.round(Math.sqrt(targetPoints / 2)));
    const cols = Math.round(targetPoints / rows);

    const latStep = 180 / rows;
    const lonStep = 360 / cols;

    const buffer = new Float32Array((rows + 1) * cols * 8);
    const coordinates = [];

    let offset = 0;
    for (let i = 0; i <= rows; i++) {
        const lat = 90 - (i * latStep);
        for (let j = 0; j < cols; j++) {
            const lon = -180 + (j * lonStep);
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

async function performGlobalWeatherDownload(): Promise<GridData> {
    const { buffer, coordinates, cols, latStep, lonStep } = createDynamicGrid(TARGET_POINTS);

    const chunks = [];
    for (let i = 0; i < coordinates.length; i += CHUNK_SIZE) {
        chunks.push(coordinates.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i += CONCURRENT_REQUESTS) {
        const batch = chunks.slice(i, i + CONCURRENT_REQUESTS);

        await Promise.all(batch.map(async (chunk) => {
            const latString = chunk.map(c => c.lat.toFixed(2)).join(',');
            const lonString = chunk.map(c => c.lon.toFixed(2)).join(',');
            const url = `${API_BASE_URL}?latitude=${latString}&longitude=${lonString}&current=temperature_2m,wind_u_component_10m,wind_v_component_10m`;

            try {
                const response = await fetch(url);
                const data = await response.json();
                const dataArray = Array.isArray(data) ? data : [data];

                for (let j = 0; j < chunk.length; j++) {
                    buffer[chunk[j].index + 2] = dataArray[j]?.current?.temperature_2m ?? 0.0;
                    buffer[chunk[j].index + 3] = dataArray[j]?.current?.wind_u_component_10m ?? 0.0;
                    buffer[chunk[j].index + 4] = dataArray[j]?.current?.wind_v_component_10m ?? 0.0;
                }
            } catch (error) {
                console.error(`[API] Fehler:`, error);
            }
        }));
    }

    console.log('[API] Scan abgeschlossen!');
    return { buffer, cols, latStep, lonStep };
}

export async function fetchWeatherData(layerType: string): Promise<GridData> {
    if (layerType === 'normal' || layerType === 'light') {
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