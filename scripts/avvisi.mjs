// Avvisi immediati nel canale Telegram: allerta che compare o sale di colore in una zona romagnola,
// fiume che supera una soglia. Gira nella Action ogni 15 minuti, dopo scripts/dati.mjs.
// Quello che è già stato avvisato sta in dati.json ("avvisi"), ripreso dalla versione pubblicata:
// così ogni novità arriva una volta sola, anche a PC spento.
// Per non bombardare il canale: un solo messaggio per giro, fiumi per fiume e non per stazione,
// notifica con suono solo da arancione / soglia 2 in su (di notte solo rossa / soglia 3), il resto arriva muto.
import { readFile, writeFile } from "node:fs/promises";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN, CHAT = process.env.TELEGRAM_CHAT;
const DRY = process.env.DRY === "1";
const PREV_URL = process.env.PREV_URL || "https://lucagiustra-creator.github.io/cieloromagna/dati.json";
const SITE = "https://cieloromagna.it";
const RIARMO_M = 0.10;   // un fiume torna avvisabile solo dopo essere sceso di 10 cm sotto la soglia
const NOTTE = [22, 7];   // ore di Roma in cui suona solo il livello più grave

const cur = JSON.parse(await readFile("dati.json", "utf8"));
let prev = null;
try {
  if (process.env.PREV_FILE) prev = JSON.parse(await readFile(process.env.PREV_FILE, "utf8"));   // per le prove in locale
  else { const r = await fetch(PREV_URL + "?t=" + Date.now()); if (r.ok) prev = await r.json(); }
} catch { /* sito non raggiungibile: si riparte come prima esecuzione */ }
const first = !prev?.avvisi;
const state = prev?.avvisi ?? { allerte: {}, fiumi: {} };
// fino al 28/10/2026 lo stato era per stazione: al primo giro col nuovo formato si registrano i fiumi senza avvisare
const firstFiumi = !state.fiumi;
state.fiumi ??= {};
delete state.stazioni;

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
const dayLabel = date => new Date(date + "T12:00:00Z").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const today = romeDate(), tomorrow = romeDate(new Date(Date.now() + 864e5));
const msgs = [];
let gravita = 0;   // il livello più alto tra le novità di questo giro: decide se la notifica suona

/* ---------- Allerte: chiave giorno|zona|fenomeno, si avvisa quando il colore sale ---------- */
const nuove = [];
for (const [key, date] of [["oggi", today], ["domani", tomorrow]]) {
  for (const z of cur[key]?.zone ?? []) for (const [ev, c] of Object.entries(z.eventi)) {
    const k = `${date}|${z.area}|${ev}`, rank = RANK[c] ?? 0, seen = state.allerte[k] ?? 0;
    // si tiene il colore più alto già avvisato per tutto il giorno: se ARPAE per un giro dà verde per errore
    // l'allerta non viene riavvisata quando torna
    if (rank > seen) { nuove.push({ date, key, area: z.area, ev, rank, was: seen }); state.allerte[k] = rank; }
  }
}
for (const k of Object.keys(state.allerte)) if (k.split("|")[0] < today) delete state.allerte[k];   // giorni passati
// un messaggio per giorno: titolo col colore più grave, poi una riga per colore e fenomeno con le zone
const byDay = new Map();
for (const a of nuove) { if (!byDay.has(a.date)) byDay.set(a.date, []); byDay.get(a.date).push(a); }
for (const [date, list] of byDay) {
  const worst = Math.max(...list.map(a => a.rank)), when = list[0].key;
  gravita = Math.max(gravita, worst);
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

/* ---------- Fiumi: livello del fiume = soglia più alta superata da una sua stazione, con riarmo ---------- */
// si avvisa quando il fiume sale di livello rispetto all'ultimo avviso; le stazioni ferme o anomale non contano
const lvlOf = (s, v, margin = 0) => s.soglie.filter(x => x != null && v >= x - margin).length;
const righe = [];
for (const f of cur.fiumi ?? []) {
  const live = f.stazioni.filter(s => !s.anomala && s.series.length && Date.now() - s.series.at(-1)[0] <= 2 * 36e5)
    .map(s => ({ s, t: s.series.at(-1)[0], v: s.series.at(-1)[1] }));
  if (!live.length) continue;   // nessun dato buono: lo stato resta com'è
  const lvl = Math.max(0, ...live.map(x => lvlOf(x.s, x.v)));
  // riarmo: il fiume è sceso di almeno 10 cm sotto la soglia già avvisata
  let seen = Math.min(state.fiumi[f.fiume] ?? 0, Math.max(0, ...live.map(x => lvlOf(x.s, x.v, RIARMO_M))));
  if (lvl > seen && !firstFiumi) {
    const over = live.map(x => ({ ...x, l: lvlOf(x.s, x.v) })).filter(x => x.l).sort((a, b) => b.l - a.l);
    righe.push({ lvl, txt: `${DOT[Math.min(3, lvl)]} <a href="${SITE}/fiumi/${slug(f.fiume)}/"><b>${esc(f.fiume)}</b></a> oltre la soglia ${lvl}: `
      + over.map(x => `${esc(x.s.name)} ${fmt2(x.v)} m (soglia ${x.l})`).join(", ") });
    gravita = Math.max(gravita, Math.min(3, lvl));
  }
  seen = Math.max(seen, lvl);
  if (seen) state.fiumi[f.fiume] = seen; else delete state.fiumi[f.fiume];
}
if (righe.length) msgs.push([
  `🌊 <b>Fiumi oltre soglia</b>`,
  ...righe.sort((a, b) => b.lvl - a.lvl).map(r => r.txt),   // prima i fiumi più gravi
  `Le soglie non sono un'allerta: fa fede il bollettino ufficiale.`,
  `👉 <a href="${SITE}/#fiumi">${SITE.replace("https://", "")}</a>`
].join("\n"));

cur.avvisi = state;
await writeFile("dati.json", JSON.stringify(cur) + "\n");

if (first) { console.log(`prima esecuzione: registrata la situazione attuale, nessun avviso (${msgs.length} novità ignorate)`); process.exit(0); }
if (firstFiumi) console.log("stato dei fiumi registrato col nuovo formato, nessun avviso fiumi in questo giro");
if (!msgs.length) { console.log("nessuna novità"); process.exit(0); }

// un solo messaggio; suona da arancione / soglia 2 in su, di notte solo con rossa / soglia 3
const ora = +new Intl.DateTimeFormat("it-IT", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Rome" }).format(new Date());
const notte = ora >= NOTTE[0] || ora < NOTTE[1];
const suona = gravita >= (notte ? 3 : 2);
const text = msgs.join("\n\n");
if (DRY || !TOKEN || !CHAT) { console.log(`--- (non inviato, ${suona ? "con suono" : "muto"})\n` + text); process.exit(0); }
const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_notification: !suona, link_preview_options: { is_disabled: true } })
});
const j = await r.json();
console.log(j.ok ? `inviato (${suona ? "con suono" : "muto"}): ${msgs.map(m => m.split("\n")[0]).join(" + ")}` : `errore Telegram: ${j.description}`);
