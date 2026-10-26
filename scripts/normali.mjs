// Medie climatiche 1991-2020 di massima e minima per ogni località e giorno dell'anno, per il riquadro "Medie" della pagina.
// Si lancia a mano (node scripts/normali.mjs) solo quando si aggiungono località: il risultato, assets/normali.json, non cambia nel tempo,
// e le località già presenti nel file vengono tenute senza riscaricarle.
// Dati: archivio Open-Meteo (rianalisi ERA5 di Copernicus/ECMWF, CC BY 4.0). Per ogni giorno si fa la media dei 30 anni
// su una finestra di ±7 giorni, così la curva dell'anno è liscia e non risente delle singole giornate.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const PLACES = [...html.matchAll(/\{ id: "([^"]+)",.*?lat: ([\d.]+), lon: ([\d.]+) \}/g)].map(m => ({ id: m[1], lat: +m[2], lon: +m[3] }));
const WIN = 7, sleep = ms => new Promise(r => setTimeout(r, ms));
// giorno dell'anno su un anno bisestile (1 gennaio = 0, 29 febbraio = 59): così ogni data ha il suo posto
const doy = s => Math.round((Date.UTC(2000, +s.slice(5, 7) - 1, +s.slice(8, 10)) - Date.UTC(2000, 0, 1)) / 864e5);

const FILE = new URL("../assets/normali.json", import.meta.url);
const out = { periodo: "1991-2020", fonte: "Open-Meteo, rianalisi ERA5 di Copernicus/ECMWF (CC BY 4.0)", finestra: WIN, luoghi: {} };
const prima = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")).luoghi : {};
for (const p of PLACES) {
  if (prima[p.id]) { out.luoghi[p.id] = prima[p.id]; continue; }
  const url = "https://archive-api.open-meteo.com/v1/archive?" + new URLSearchParams({
    latitude: p.lat, longitude: p.lon, start_date: "1991-01-01", end_date: "2020-12-31", timezone: "Europe/Rome", daily: "temperature_2m_max,temperature_2m_min"
  });
  // 30 anni di dati pesano molto sul limite al minuto dell'archivio: se risponde 429 si aspetta e si riprova
  let r = await fetch(url);
  while (r.status === 429) { await sleep(65e3); r = await fetch(url); }
  if (!r.ok) throw new Error(`${p.id}: HTTP ${r.status} ${await r.text()}`);
  const D = (await r.json()).daily;
  const sum = { max: Array(366).fill(0), min: Array(366).fill(0) }, n = Array(366).fill(0);
  D.time.forEach((t, i) => {
    const d = doy(t);
    if (D.temperature_2m_max[i] == null || D.temperature_2m_min[i] == null) return;
    sum.max[d] += D.temperature_2m_max[i]; sum.min[d] += D.temperature_2m_min[i]; n[d]++;
  });
  const smooth = a => a.map((_, d) => {
    let s = 0, c = 0;
    for (let k = -WIN; k <= WIN; k++) { const j = (d + k + 366) % 366; s += a[j]; c += n[j]; }
    return Math.round(s / c * 10) / 10;
  });
  out.luoghi[p.id] = { max: smooth(sum.max), min: smooth(sum.min) };
  console.log(p.id, "26/10:", out.luoghi[p.id].max[doy("2000-10-26")], "/", out.luoghi[p.id].min[doy("2000-10-26")]);
  await sleep(3000);
}
writeFileSync(FILE, JSON.stringify(out));
