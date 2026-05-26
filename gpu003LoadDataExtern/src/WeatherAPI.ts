export class WeatherAPI {
    // Diese Funktion wird später das Open-Meteo JSON in ein Array verwandeln
    public static async fetchWindGrid(device: GPUDevice): Promise<GPUTexture> {
        // --- STUB: Hier arbeitet später Person 1 ---
        // const response = await fetch('open-meteo...');
        // const data = transformToJson(response);
        
        // VORERST: Dummy-Daten (Buntes Rauschen als "Wind") generieren
        const width = 2; const height = 2;
        const dummyData = new Uint8Array([200, 150, 0, 255, 100, 200, 0, 255, 150, 100, 0, 255, 220, 180, 0, 255]);

        const texture = device.createTexture({
            size: [width, height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });

        device.queue.writeTexture(
            { texture }, dummyData,
            { bytesPerRow: width * 4 }, { width, height }
        );

        return texture;
    }
}