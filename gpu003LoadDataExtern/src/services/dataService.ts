export type ClimateLayer = 'normal' | 'temperature' | 'wind' | 'light';

// Oeffentliche globale API
const API_BASE_URL = 'https://api.open-meteo.com/v1/forecast';

// MATHEMATIK-ANPASSUNG: 5-Grad-Raster fuer Public-API Schutz
// 37 Breitengrade x 72 Laengengrade = 2.664 Punkte Gesamt (Sicher unter dem 10.000er Tageslimit)
const LAT_MIN = -90, LAT_MAX = 90, LAT_STEP = 5;
const LON_MIN = -180, LON_MAX = 175, LON_STEP = 5;

// STRIKTE drosselung fuer das 600-Punkte-pro-Minute-Limit
const CHUNK_SIZE = 100;            // 100 Punkte pro HTTP-Aufruf = 100 verbrauchte API-Einheiten
const CONCURRENT_REQUESTS = 1;     // Strikt nacheinander abarbeiten
const TIME_BUFFER_MS = 11000;      // 11 Sekunden Pause nach jedem Chunk (~545 Punkte / Minute)

interface GridContext {
  buffer: Float32Array;
  coordinates: { lat: number; lon: number; index: number }[];
}

let cachedGlobalWeatherBuffer: Float32Array | null = null;
let isFetchingWeather = false; 
let fetchWeatherPromise: Promise<Float32Array> | null = null;

// Hilfsfunktion fuer die Pausen
const waitForTime = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function createEmptyGridBuffer(): GridContext {
  const lats = Math.floor(Math.abs(LAT_MAX - LAT_MIN) / LAT_STEP) + 1;
  const lons = Math.floor(Math.abs(LON_MAX - LON_MIN) / LON_STEP) + 1;
  const totalPoints = lats * lons;

  const buffer = new Float32Array(totalPoints * 8); // 8 Floats Alignment fuer WebGPU Storage Struct
  const coordinates: { lat: number; lon: number; index: number }[] = [];

  let offset = 0;
  for (let lat = LAT_MAX; lat >= LAT_MIN; lat -= LAT_STEP) {
    for (let lon = LON_MIN; lon <= LON_MAX; lon += LON_STEP) {
      coordinates.push({ lat, lon, index: offset });
      buffer[offset] = lat;
      buffer[offset + 1] = lon;
      buffer[offset + 2] = 0.0;
      buffer[offset + 3] = 0.0;
      buffer[offset + 4] = 0.0;
      offset += 8;
    }
  }
  return { buffer, coordinates };
}

// --- CACHE LOGIK WIEDER EINGEFÜGT ---
function loadFromCache(): Float32Array | null {
  try {
    const today = new Date().toISOString().split('T')[0];
    const cacheDate = localStorage.getItem('weather_cache_date');
    if (cacheDate === today) {
      const cacheData = localStorage.getItem('weather_cache_data');
      if (cacheData) {
        console.log('[API] Wetterdaten aus dem lokalen Browser-Cache geladen.');
        return new Float32Array(JSON.parse(cacheData));
      }
    }
  } catch (error) {
    console.warn('[API] Fehler beim Lesen des Caches:', error);
  }
  return null;
}

function saveToCache(buffer: Float32Array) {
  try {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem('weather_cache_date', today);
    localStorage.setItem('weather_cache_data', JSON.stringify(Array.from(buffer)));
  } catch (error) {
    console.warn('[API] Cache konnte nicht geschrieben werden:', error);
  }
}
// -------------------------------------

async function fetchWithRateLimitCheck(url: string): Promise<any> {
  const response = await fetch(url);
  if (response.status === 429) {
    console.warn('[API] Rate-Limit-Warnung der API erhalten. Erzwungene Pause...');
    await waitForTime(30000); // 30 Sekunden hard-stop bei 429
    return fetchWithRateLimitCheck(url);
  }
  if (!response.ok) throw new Error(`API meldet Status: ${response.status}`);
  return await response.json();
}

async function performGlobalWeatherDownload(onProgress?: (buffer: Float32Array) => void): Promise<Float32Array> {
  const cachedData = loadFromCache();
  if (cachedData) {
    return cachedData;
  }

  console.log('[API] Starte Download mit Echtzeit-Scanner-Effekt...');
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
      
      const url = `${API_BASE_URL}?latitude=${latString}&longitude=${lonString}&current=temperature_2m,wind_u_component_10m,wind_v_component_10m&models=gfs_seamless`;

      try {
        const data = await fetchWithRateLimitCheck(url);
        const dataArray = Array.isArray(data) ? data : [data];
        
        for (let j = 0; j < chunk.length; j++) {
          buffer[chunk[j].index + 2] = dataArray[j]?.current?.temperature_2m ?? 0.0;
          buffer[chunk[j].index + 3] = dataArray[j]?.current?.wind_u_component_10m ?? 0.0;
          buffer[chunk[j].index + 4] = dataArray[j]?.current?.wind_v_component_10m ?? 0.0;
        }
      } catch (error) {
        console.error(`[API] Fehler in Chunk:`, error);
      }
    }));

    const progress = Math.round((Math.min(i + CONCURRENT_REQUESTS, chunks.length) / chunks.length) * 100);
    console.log(`[API] Scan-Fortschritt: ${progress}%`);

    // Echtzeit-Update an die Grafikkarte
    if (onProgress) {
      onProgress(buffer);
    }

    if (progress < 100) {
      await waitForTime(TIME_BUFFER_MS);
    }
  }

  console.log('[API] Satelliten-Scan abgeschlossen!');
  saveToCache(buffer);
  return buffer;
}

export async function fetchWeatherData(
  layerType: string, 
  onProgress?: (buffer: Float32Array) => void
): Promise<Float32Array> {
  if (layerType === 'normal' || layerType === 'light') return new Float32Array(0);
  
  if (cachedGlobalWeatherBuffer) {
    if (onProgress) onProgress(cachedGlobalWeatherBuffer); // Wenn gecacht, sofort anzeigen
    return cachedGlobalWeatherBuffer;
  }
  
  if (isFetchingWeather && fetchWeatherPromise) return await fetchWeatherPromise;

  isFetchingWeather = true;
  fetchWeatherPromise = performGlobalWeatherDownload(onProgress);
  try {
    cachedGlobalWeatherBuffer = await fetchWeatherPromise;
  } finally {
    isFetchingWeather = false;
    fetchWeatherPromise = null;
  }
  return cachedGlobalWeatherBuffer;
}