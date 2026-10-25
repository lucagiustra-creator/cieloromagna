// Avvisi immediati nel canale Telegram: allerta che compare o sale di colore in una zona romagnola,
// stazione di un fiume che supera una soglia. Gira nella Action ogni 15 minuti, dopo scripts/dati.mjs.
// Quello che è già stato avvisato sta in dati.json ("avvisi"), ripreso dalla versione pubblicata:
// così ogni novità arriva una volta sola, anche a PC spento.
import { readFile, writeFile } from "node:fs/promises";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN, CHAT = process.env.TELEGRAM_CHAT;
const DRY = process.env.DRY === "1";
const PREV_URL = process.env.PREV_URL || "https://lucagiustra-creator.github.io/cieloromagna/dati.json";
const SITE = "https://cieloromagna.it";
const RIARMO_M = 0.10;   // una stazione torna avvisabile solo dopo essere scesa di 10 cm sotto la soglia

const cur = JSON.parse(await readFile("dati.json", "utf8"));
let prev = null;
try {
  if (process.env.PREV_FILE) prev = JSON.parse(await readFile(process.env.PREV_FILE, "utf8"));   // per le prove in locale
  else { const r = await fetch(PREV_URL + "?t=" + Date.now()); if (r.ok) prev = await r.json(); }
} catch { /* sito non raggiungibile: si riparte come prima esecuzione */ }
const first = !prev?.avvisi;
const state = prev?.avvisi ?? { allerte: {}, stazioni: {} };

const tpl = await readFile("index.html", "utf8");
const ZONES = Object.fromEntries([...tpl.matchAll(/(\w\d): \{ name: "([^"]+)"/g)].map(m => [m[1], m[2]]));
const EVENTS = { "idraulica": "piene dei fiumi", "idrogeologica": "frane e piene dei corsi minori", "temporali": "temporali", "vento": "vento",
  "temperature-estreme": "temperature estreme", "neve": "neve", "ghiaccio-pioggia-gela": "ghiaccio e pioggia che gela", "stato-mare": "stato del mare", "mareggiate": "mareggiate" };
const RANK = { green: 0, yellow: 1, orange: 2, red: 3 }, COLOR = ["verde", "gialla", "arancione", "rossa"], DOT = ["🟢", "🟡", "🟠", "🔴"];
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const listIt = a => a.length <= 1 ? (a[0] ?? "") : a.slice(0, -1).join(", ") + " e " + a.at(-1);
const fmt2 = n => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const romeDate = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(d);   // 2026-10-25
const romeTime = t => new Date(t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
const dayLabel = date => new Date(date + "T12:00:00Z").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const today = romeDate(), tomorrow = romeDate(new Date(Date.now() + 864e5));
const msgs = [];

/* ---------- Allerte: chiave giorno|zona|fenomeno, si avvisa quando il colore sale ---------- */
const nuove = [];
for (const [key, date] of [["oggi", today], ["domani", tomorrow]]) {
  for (const z of cur[key]?.zone ?? []) for (const [ev, c] of Object.entries(z.eventi)) {
    const k = `${date}|${z.area}|${ev}`, rank = RANK[c] ?? 0, seen = state.allerte[k] ?? 0;
    if (rank > seen) nuove.push({ date, key, area: z.area, ev, rank, was: seen });
    if (rank > 0) state.allerte[k] = rank; else delete state.allerte[k];
  }
}
for (const k of Object.keys(state.allerte)) if (k.split("|")[0] < today) delete state.allerte[k];   // giorni passati
// un messaggio per giorno: titolo col colore più grave, poi una riga per colore e fenomeno con le zone
const byDay = new Map();
for (const a of nuove) { if (!byDay.has(a.date)) byDay.set(a.date, []); byDay.get(a.date).push(a); }
for (const [date, list] of byDay) {
  const worst = Math.max(...list.map(a => a.rank)), when = list[0].key;
  const up = list.some(a => a.was > 0) ? " (sale di livello)" : "";
  const rows = new Map();   // "rank|fenomeno" → zone
  for (const a of list) { const k = `${a.rank}|${a.ev}`; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(ZONES[a.area] ?? a.area); }
  const lines = [...rows].sort((x, y) => y[0].localeCompare(x[0])).map(([k, zone]) => {
    const [r, ev] = k.split("|");
    return `${DOT[+r]} ${esc(EVENTS[ev] ?? ev)} (${COLOR[+r]}): ${esc(listIt([...new Set(zone)]))}`;
  });
  const bul = (cur.bollettini ?? []).filter(b => b.dal <= date + "T23:59").sort((x, y) => y.dal.localeCompare(x.dal))[0];
  msgs.push([
    `${DOT[worst]} <b>Allerta ${COLOR[worst]} ${when}</b>, ${dayLabel(date)}${up}`,
    ...lines,
    bul ? `Bollettino: <a href="${bul.url}">${esc(bul.nome)}</a>` : `Bollettino: <a href="https://allertameteo.regione.emilia-romagna.it/">Allerta Meteo ER</a>`,
    `👉 <a href="${SITE}/#allerte">${SITE.replace("https://", "")}</a>`
  ].join("\n"));
}

/* ---------- Fiumi: stazione oltre soglia, con riarmo sotto la soglia ---------- */
for (const f of cur.fiumi ?? []) for (const s of f.stazioni) {
  const last = s.series.at(-1);
  if (!last || Date.now() - last[0] > 2 * 36e5) continue;   // dato fermo: niente avvisi
  const [t, v] = last;
  const lvl = s.soglie.filter(x => x != null && v >= x).length;
  let seen = state.stazioni[s.id] ?? 0;
  // riarmo: sceso abbastanza sotto la soglia già avvisata
  while (seen > 0 && (s.soglie[seen - 1] == null || v < s.soglie[seen - 1] - RIARMO_M)) seen--;
  if (lvl > seen) {
    const soglia = s.soglie[lvl - 1];
    msgs.push([
      `${DOT[Math.min(3, lvl)]} <b>${esc(f.fiume)} oltre la soglia ${lvl}</b> a ${esc(s.name)}`,
      `${fmt2(v)} m alle ${romeTime(t)} (soglia ${lvl}: ${fmt2(soglia)} m)`,
      `Le soglie non sono un'allerta: fa fede il bollettino ufficiale.`,
      `👉 <a href="${SITE}/fiumi/${slug(f.fiume)}/">andamento ${esc(f.fiume)}</a>`
    ].join("\n"));
    seen = lvl;
  }
  if (seen) state.stazioni[s.id] = seen; else delete state.stazioni[s.id];
}

cur.avvisi = state;
await writeFile("dati.json", JSON.stringify(cur) + "\n");

if (first) { console.log(`prima esecuzione: registrata la situazione attuale, nessun avviso (${msgs.length} novità ignorate)`); process.exit(0); }
if (!msgs.length) { console.log("nessuna novità"); process.exit(0); }
const footer = "\n\n<i>Non è un servizio ufficiale: per le allerte fa fede Allerta Meteo Emilia-Romagna.</i>";
for (const m of msgs) {
  if (DRY || !TOKEN || !CHAT) { console.log("--- (non inviato)\n" + m + footer); continue; }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: m + footer, parse_mode: "HTML", link_preview_options: { is_disabled: true } })
  });
  const j = await r.json();
  console.log(j.ok ? `inviato: ${m.split("\n")[0]}` : `errore Telegram: ${j.description}`);
}
