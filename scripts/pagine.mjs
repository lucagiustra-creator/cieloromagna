// Genera da index.html una pagina per ogni località (/faenza/) e per ogni fiume (/fiumi/lamone/),
// con titolo, descrizione, intestazione e testo propri, più sitemap.xml e robots.txt per i motori di ricerca.
// Uso: node scripts/pagine.mjs _site   (la cartella deve già contenere assets, dati.json ecc.)
import { readFile, writeFile, mkdir } from "node:fs/promises";

const OUT = process.argv[2] || "_site";
const SITE = "https://cieloromagna.it";
const tpl = await readFile("index.html", "utf8");

// località e zone lette direttamente da index.html, così non ci sono due elenchi da tenere allineati
const PLACES = new Function(`return ${tpl.match(/const PLACES = (\[[\s\S]*?\n\]);/)[1]}`)();
const ZONES = Object.fromEntries([...tpl.matchAll(/(\w\d): \{ name: "([^"]+)"/g)].map(m => [m[1], m[2]]));
const PROV = { ravenna: "RA", cervia: "RA", cesenatico: "FC", rimini: "RN", riccione: "RN", imola: "BO", lugo: "RA", faenza: "RA",
  forli: "FC", cesena: "FC", brisighella: "RA", predappio: "FC", novafeltria: "RN", "santa-sofia": "FC", "bagno-di-romagna": "FC" };

// fiumi e stazioni: da dati.json se c'è, altrimenti solo i nomi dei fiumi da scripts/dati.mjs
let RIVERS;
try {
  const d = JSON.parse(await readFile("dati.json", "utf8"));
  RIVERS = d.fiumi.map(f => ({ name: f.fiume, stations: f.stazioni.map(s => s.name) }));
} catch {
  RIVERS = [...(await readFile("scripts/dati.mjs", "utf8")).matchAll(/fiume: "([^"]+)"/g)].map(m => ({ name: m[1], stations: [] }));
}
const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// "del Lamone", "dell'Uso", "dei Fiumi Uniti", "del Rubicone e del Pisciatello"
const del = n => n === "Fiumi Uniti" ? "dei Fiumi Uniti" : /^[AEIOU]/.test(n) ? `dell'${n}` : "del " + n.replace(" e ", " e del ");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// nomi ARPAE abbreviati resi leggibili: "Forli'" → "Forlì", "S. Sofia" → "Santa Sofia", "Rivalta RA" → "Rivalta"
const SAINTS = { "S. Maria Nova": "Santa Maria Nova", "S. Sofia": "Santa Sofia", "S. Agata": "Sant'Agata" };
const cleanName = s => SAINTS[s] ?? s.replace(/i'$/, "ì").replace(/^S\. /, "San ").replace(/ RA$/, "");
const listIt = a => a.length <= 1 ? (a[0] ?? "") : a.slice(0, -1).join(", ") + " e " + a.at(-1);

function links(current) {
  const a = (href, text) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${esc(text)}</a>`;
  return `<nav aria-label="Meteo per località"><b>Meteo:</b>${PLACES.map(p => a(`/${p.id}/`, p.name)).join("")}</nav>
    <nav aria-label="Livelli dei fiumi"><b>Fiumi:</b>${RIVERS.map(r => a(`/fiumi/${slug(r.name)}/`, r.name)).join("")}</nav>`;
}

function page({ path, title, description, h1, intro, data }) {
  const url = SITE + path;
  let s = tpl
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">\n<link rel="canonical" href="${url}">`)
    .replace("<h1>Previsioni per la Romagna</h1>", `<h1>${esc(h1)}</h1>`)
    .replace("<!--PAGINA-->", data ? `<script>window.CR_PAGE = ${JSON.stringify(data)};</script>\n` : "")
    .replace("<!--SEO-->", `<div class="seo"><p>${esc(intro)}</p>\n    ${links(path)}</div>`);
  return s;
}

const pages = [];
pages.push({
  path: "/",
  title: "Cielo Romagna · meteo, allerte e fiumi",
  description: "Meteo della Romagna in un colpo d'occhio: previsioni per la tua località, radar, allerte ufficiali e livelli dei fiumi dalla costa all'Appennino.",
  h1: "Previsioni per la Romagna",
  intro: "Previsioni meteo per 15 località della Romagna, dalla costa all'Appennino: temperatura adesso, se pioverà oggi e domani, radar, previsioni a 7 giorni, allerte ufficiali di Allerta Meteo Emilia-Romagna e livelli dei fiumi in tempo reale."
});
for (const p of PLACES) {
  const zone = ZONES[p.area] ? `${p.area} (${ZONES[p.area]})` : p.area;
  pages.push({
    path: `/${p.id}/`,
    title: `Meteo ${p.name} oggi e domani · Cielo Romagna`,
    description: `Previsioni meteo per ${p.name}: temperatura adesso, pioverà oggi e domani, radar, 7 giorni, allerte ufficiali e livello ${del(p.river)}. Aggiornate ogni 15 minuti.`,
    h1: `Previsioni per ${p.name}`,
    intro: `Previsioni meteo per ${p.name} (${PROV[p.id] ?? ""}): la temperatura adesso, se pioverà oggi e domani con l'affidabilità dei modelli, le previsioni ora per ora e a 7 giorni, il radar delle precipitazioni, le allerte ufficiali della zona ${zone} e il livello ${del(p.river)}. Dati aggiornati ogni 15 minuti.`,
    data: { place: p.id }
  });
}
for (const r of RIVERS) {
  const st = r.stations.map(cleanName);
  const from = st.length > 1 ? `da ${st.length} stazioni ARPAE (${listIt(st)})` : st.length ? `dalla stazione ARPAE di ${st[0]}` : "dagli idrometri ARPAE";
  const place = PLACES.find(p => p.river === r.name);
  pages.push({
    path: `/fiumi/${slug(r.name)}/`,
    title: `Livello ${del(r.name)} in tempo reale · Cielo Romagna`,
    description: `Livello idrometrico ${del(r.name)} in tempo reale ${from}: andamento delle ultime 48 ore, soglie di allerta e allerte ufficiali.`,
    h1: `Livello ${del(r.name)} in tempo reale`,
    intro: `Livello idrometrico ${del(r.name)} in tempo reale ${from}, ripreso ogni 15 minuti da Allerta Meteo Emilia-Romagna: livello attuale, andamento delle ultime 48 ore e soglie di allerta. Le soglie idrometriche non sono un'allerta: per piene e allagamenti fa fede il bollettino ufficiale.`,
    data: { tab: "fiumi", river: r.name, ...(place ? { place: place.id } : {}) }
  });
}

for (const p of pages) {
  const dir = OUT + p.path;
  await mkdir(dir, { recursive: true });
  await writeFile(dir + "index.html", page(p));
}
const today = new Date().toISOString().slice(0, 10);
await writeFile(`${OUT}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url><loc>${SITE}${p.path}</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>${p.path === "/" ? "1.0" : p.path.startsWith("/fiumi/") ? "0.7" : "0.8"}</priority></url>`).join("\n")}
</urlset>
`);
await writeFile(`${OUT}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`pagine generate: ${pages.length} (${PLACES.length} località, ${RIVERS.length} fiumi) + sitemap.xml e robots.txt`);
