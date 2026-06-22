export type ClimateLayer = 'normal' | 'temperature' | 'wind' | 'light';

const LOKALE_API_IP = '127.0.0.1'; // Passe dies an deine LXC IP an, wenn du nicht auf localhost bist
const LOKALE_API_PORT = '8080';

const LAT_MIN = -90, LAT_MAX = 90, LAT_STEP = 2;
const LON_MIN = -180, LON_MAX = 179, LON_STEP = 2;
const CHUNK_SIZE = 100;
const CONCURRENT_REQUESTS = 20; 

interface GridContext {
  buffer: Float32Array;
  coordinates: { lat: number; lon: number; index: number }[];
}

let cachedGlobalWeatherBuffer: Float32Array | null = null;
let isFetchingWeather = false; 
let fetchWeatherPromise: Promise<Float32Array> | null = null;

function createEmptyGridBuffer(): GridContext {
  const lats = Math.floor(Math.abs(LAT_MAX - LAT_MIN) / LAT_STEP) + 1;
  const lons = Math.floor(Math.abs(LON_MAX - LON_MIN) / LON_STEP) + 1;
  const totalPoints = lats * lons;

  // 8 Floats pro Punkt fuer perfektes WebGPU Memory Alignment!
  const buffer = new Float32Array(totalPoints * 8);
  const coordinates: { lat: number; lon: number; index: number }[] = [];

  let offset = 0;
  for (let lat = LAT_MAX; lat >= LAT_MIN; lat -= LAT_STEP) {
    for (let lon = LON_MIN; lon <= LON_MAX; lon += LON_STEP) {
      coordinates.push({ lat, lon, index: offset });
      buffer[offset] = lat;       // lat
      buffer[offset + 1] = lon;   // lon
      buffer[offset + 2] = 0.0;   // temp
      buffer[offset + 3] = 0.0;   // windU
      buffer[offset + 4] = 0.0;   // windV
      buffer[offset + 5] = 0.0;   // pad1
      buffer[offset + 6] = 0.0;   // pad2
      buffer[offset + 7] = 0.0;   // pad3
      offset += 8;
    }
  }
  return { buffer, coordinates };
}

async function fetchLocalAPI(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API Fehler: ${response.status}`);
  return await response.json();
}

async function performGlobalWeatherDownload(): Promise<Float32Array> {
  console.log('[API] Starte Download (GFS 13km, Temp + U/V Wind)...');
  const { buffer, coordinates } = createEmptyGridBuffer();
  
  const chunks = [];
  for (let i = 0; i < coordinates.length; i += CHUNK_SIZE) {
    chunks.push(coordinates.slice(i, i + CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i += CONCURRENT_REQUESTS) {
    const batch = chunks.slice(i, i + CONCURRENT_REQUESTS);
    
    await Promise.all(batch.map(async (chunk) => {
      const latString = chunk.map(c => c.lat.toFixed(2)).join(',');
      const lonString = chunk.map(c => c.lon.toFixed(2)).join(',');
      
      const url = `http://${LOKALE_API_IP}:${LOKALE_API_PORT}/v1/forecast?latitude=${latString}&longitude=${lonString}&current=temperature_2m,wind_u_component_10m,wind_v_component_10m&models=ncep_gfs013`;

      try {
        const data = await fetchLocalAPI(url);
        const dataArray = Array.isArray(data) ? data : [data];
        
        for (let j = 0; j < chunk.length; j++) {
          buffer[chunk[j].index + 2] = dataArray[j]?.current?.temperature_2m ?? 0.0;
          buffer[chunk[j].index + 3] = dataArray[j]?.current?.wind_u_component_10m ?? 0.0;
          buffer[chunk[j].index + 4] = dataArray[j]?.current?.wind_v_component_10m ?? 0.0;
        }
      } catch (error) {
        console.error(`[API] Chunk fehlgeschlagen`, error);
      }
    }));

    const progress = Math.round((Math.min(i + CONCURRENT_REQUESTS, chunks.length) / chunks.length) * 100);
    console.log(`[API] Fortschritt: ${progress}%`);
  }

  return buffer;
}

export async function fetchWeatherData(layerType: string): Promise<Float32Array> {
  if (layerType === 'normal' || layerType === 'light') return new Float32Array(0);
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