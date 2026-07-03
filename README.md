# WebGPU Climate Globe

Ein interaktiver, fotorealistischer 3D-Globus zur Echtzeit-Visualisierung von globalen Klimadaten. 

---

## Features

* **Echtzeit-Wetterdaten:** Anbindung an die Open-Meteo API für Live-Daten zu Temperatur, Windgeschwindigkeiten und Luftqualität (AQI).
* **Partikelsimulation:** Komplexe Strömungssimulation für globale Winde, berechnet direkt auf der Grafikkarte (GPU Compute Shader).
* **Dynamische Heatmaps:** Präzise Farbverläufe bei Temperatur- und AQI-Ansichten.
* **Interaktiv:** Frei drehbarer und zoombarer Globus, anpassbarer Sonnenstand zur Lichtsimulation sowie anklickbare Datenpunkte (Tooltips) für exakte lokale Messwerte.

---

## Ansichten & Layer

Die Anwendung bietet verschiedene Daten-Layer, die über das Menü umgeschaltet werden können:

### 1. Normale Ansicht (Fotorealismus)
Fotorealistische Darstellung der Erde mit Ozeantiefen, simuliertem Tag-Nacht-Zyklus und dynamischen Wolkenformationen.
<img width="1024" height="509" alt="image" src="https://github.com/user-attachments/assets/7a7b58dc-8b4c-4d0d-8641-e9b139585361" />


### 2. Temperatur
Visualisiert globale Erwärmungsmuster. Von arktischer Kälte bis zu extremer Äquatorhitze.
<img width="1269" height="619" alt="image" src="https://github.com/user-attachments/assets/12879ff3-49b9-478e-a3d6-3b2bcec0b6df" />


### 3. Luftqualität (AQI)
Zeigt die globale Feinstaubbelastung und Luftqualität in Echtzeit an (US AQI Standard).
<img width="1024" height="501" alt="image" src="https://github.com/user-attachments/assets/75018ad1-89ba-4930-99c1-cccbfe26afad" />


### 4. Windströme
Echtzeit-Partikelsimulation der globalen Windgeschwindigkeiten und Wirbelstürme.
<img width="1272" height="620" alt="image" src="https://github.com/user-attachments/assets/26bf3a52-340a-4671-8a7d-81c80b635035" />


---

## Technologien

* **Frontend-Framework:** React 18, TypeScript, Vite
* **Grafik-API:** WebGPU (WGSL für Shader)
* **Styling:** SCSS (Modulares CSS Nesting)
* **Datenquelle:** Open-Meteo API
* **Code-Qualität:** Prettier
