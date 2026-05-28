export async function fetchWeatherData(layerType: string): Promise<Float32Array> {
  console.log(`[Data Service] Lade Daten für Layer: ${layerType}...`);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const dummyData = new Float32Array(100);
  for (let i = 0; i < dummyData.length; i++) {
    dummyData[i] = Math.random();
  }
  console.log(`[Data Service] Daten für ${layerType} erfolgreich geladen.`);
  return dummyData;
}
