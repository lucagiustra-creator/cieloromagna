// Scarica da Allerta Meteo Emilia-Romagna (ARPAE) le allerte di oggi e domani e i livelli dei fiumi romagnoli,
// e li salva in dati.json accanto alla pagina: il server ARPAE non permette la lettura diretta dal browser.
// Se ARPAE non risponde riusa l'ultimo dati.json pubblicato, così la pagina mostra il dato vecchio con la sua ora.
import { writeFile } from "node:fs/promises";

const API = "https://allertameteo.regione.emilia-romagna.it/o/api/allerta";
const LEVEL = "254,0,0/1,-,-,-/B13215";
const PREV_URL = process.env.PREV_URL || "https://lucagiustra-creator.github.io/cieloromagna/dati.json";
const UA = { "User-Agent": "cieloromagna.it (GitHub Action, progetto personale non commerciale)" };
const KEEP_MS = 48 * 3600e3, STEP_MS = 3600e3;

// zone di allertamento che coprono la Romagna (C2 e D1 comprendono anche comuni bolognesi)
const ZONES = ["A1", "A2", "B1", "B2", "C2", "D1"];

// stazioni da monte a valle, raggruppate per fiume secondo l'ordinamento per bacino di ARPAE
const RIVERS = [
  { fiume: "Santerno", stazioni: ["5439", "3143", "3140", "3134"] },
  { fiume: "Senio", stazioni: ["5563", "3057", "3135", "3137"] },
  { fiume: "Marzeno", stazioni: ["3195", "3176"] },
  { fiume: "Lamone", stazioni: ["3037", "3214", "3189", "3204", "3194"] },
  { fiume: "Rabbi", stazioni: ["53097", "3198"] },
  { fiume: "Montone", stazioni: ["3206", "3055", "3190", "3051", "3210"] },
  { fiume: "Bidente-Ronco", stazioni: ["3212", "5430", "3207", "3052", "3208"] },
  { fiume: "Fiumi Uniti", stazioni: ["3203"] },
  { fiume: "Bevano", stazioni: ["3036", "3182"] },
  { fiume: "Savio", stazioni: ["3202", "3193", "5431", "3187", "3216"] },
  { fiume: "Rubicone e Pisciatello", stazioni: ["3215", "3184"] },
  { fiume: "Uso", stazioni: ["11099"] },
  { fiume: "Marecchia", stazioni: ["53082", "5359", "5358"] },
  { fiume: "Ausa", stazioni: ["12479"] },
  { fiume: "Conca", stazioni: ["11100"] }
];

async function json(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// "idraulica:green,temporali:yellow,..." → { idraulica: "green", temporali: "yellow", ... }
const parseEvents = s => Object.fromEntries(String(s ?? "").split(",").filter(Boolean).map(x => x.split(":")));

async function alerts(endpoint) {
  const rows = await json(`${API}/${endpoint}`);
  return ZONES.map(z => ({ area: z, eventi: parseEvents(rows.find(r => r.area === z)?.eventi) }));
}

// una serie a punti orari più l'ultimo valore, per tenere il file leggero
function thin(points) {
  const out = [];
  for (const p of points) if (!out.length || p[0] - out.at(-1)[0] >= STEP_MS) out.push(p);
  if (points.length && out.at(-1) !== points.at(-1)) out.push(points.at(-1));
  return out;
}

async function station(id, meta) {
  const m = meta.find(x => x.idstazione === id);
  const series = (await json(`${API}/get-time-series/?stazione=${id}&variabile=${LEVEL}`))
    .filter(p => p.v != null && p.t >= Date.now() - KEEP_MS)
    .map(p => [p.t, Math.round(p.v * 100) / 100]);
  // soglia 0 = soglia non definita per quella stazione
  const soglie = [m?.soglia1, m?.soglia2, m?.soglia3].map(v => v ? v : null);
  // ARPAE dà le coordinate in centomillesimi di grado
  const lat = m?.lat ? +m.lat / 1e5 : null, lon = m?.lon ? +m.lon / 1e5 : null;
  return { id, name: m?.nomestaz ?? id, lat, lon, soglie, series: thin(series) };
}

// poche richieste alla volta per non pesare sul server ARPAE
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]).catch(e => ({ error: e.message })); }
  }));
  return out;
}

let prev = null;
try { prev = await json(PREV_URL); } catch { /* primo giro o sito non raggiungibile */ }

const out = { fonte: "Allerta Meteo Emilia-Romagna", scaricato: Date.now() };
let problems = 0;

for (const [key, ep] of [["oggi", "get-stato-allerta"], ["domani", "get-stato-allerta-domani"]]) {
  try { out[key] = { aggiornato: Date.now(), zone: await alerts(ep) }; }
  catch (e) { problems++; console.error(`allerte ${key}: ${e.message}`); out[key] = prev?.[key] ?? null; }
}

// numero e validità dei bollettini dalla pagina "Allerte e bollettini": l'API delle zone non li dà
// (l'ora di emissione sta solo nel PDF, quindi non la mostriamo)
try {
  const r = await fetch("https://allertameteo.regione.emilia-romagna.it/allerte-e-bollettini", { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status}`);
  const html = await r.text();
  const re = /Allerta-Bollettino\/id\/(\d+)"[^>]*>\s*((?:Bollettino di vigilanza|Allerta)\s+\d+\/\d{4})\s+valid[oa] dalle (\d{2}:\d{2}) del (\d{2})\/(\d{2})\/(\d{4}):\s*([^<]*)/g;
  out.bollettini = [...html.matchAll(re)].slice(0, 4).map(m => ({
    nome: m[2].trim(), dal: `${m[6]}-${m[5]}-${m[4]}T${m[3]}`, sintesi: m[7].trim().replace(/\.$/, ""),
    url: `https://allertameteo.regione.emilia-romagna.it/web/guest/singola-allerta/-/asset_publisher/FZPQSb6AzKtJ/Allerta-Bollettino/id/${m[1]}`
  }));
  if (!out.bollettini.length) throw new Error("formato della pagina cambiato");
} catch (e) { problems++; console.error(`bollettini: ${e.message}`); out.bollettini = prev?.bollettini ?? []; }

let meta = [];
try { meta = (await json(`${API}/get-sensor-values-no-time?variabile=${LEVEL}`)).filter(x => x.idstazione); }
catch (e) { problems++; console.error(`anagrafica stazioni: ${e.message}`); }

const prevStation = id => prev?.fiumi?.flatMap(f => f.stazioni).find(s => s.id === id);
out.fiumi = [];
for (const r of RIVERS) {
  const got = meta.length ? await mapLimit(r.stazioni, 4, id => station(id, meta)) : r.stazioni.map(() => ({ error: "anagrafica mancante" }));
  out.fiumi.push({
    fiume: r.fiume,
    stazioni: got.map((s, i) => {
      if (!s.error && s.series.length) return s;
      problems++;
      console.error(`${r.fiume} ${r.stazioni[i]}: ${s.error ?? "serie vuota"}`);
      return prevStation(r.stazioni[i]) ?? { id: r.stazioni[i], name: r.stazioni[i], soglie: [null, null, null], series: [] };
    })
  });
}

await writeFile("dati.json", JSON.stringify(out) + "\n");
for (const f of out.fiumi) console.log(`${f.fiume}: ` + f.stazioni.map(s => `${s.name} ${s.series.at(-1)?.[1] ?? "n.d."}`).join(" · "));
console.log(`allerte oggi: ${out.oggi ? "ok" : "mancanti"} · domani: ${out.domani ? "ok" : "mancanti"} · problemi: ${problems}`);

// la Action fallisce (e GitHub manda la mail) solo se il dato più recente ha più di due ore
const newest = Math.max(0, ...out.fiumi.flatMap(f => f.stazioni.map(s => s.series.at(-1)?.[0] ?? 0)));
if (Date.now() - newest > 2 * 3600e3) { console.error("Livelli fermi da più di due ore"); process.exit(1); }
