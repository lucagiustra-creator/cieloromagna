// Messaggio del mattino nel canale Telegram di Cielo Romagna: pioverà oggi e domani per costa, pianura e collina,
// allerte ufficiali e fiumi, con il link al sito. Modi: "prova" (con l'intestazione di prova) e "mattina".
// Il canale è TELEGRAM_CHAT (es. @cieloromagna); se manca lo cerca tra gli aggiornamenti del bot.
import { readFile } from "node:fs/promises";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MODE = process.argv[2] || "prova";
const DATI_URL = "https://lucagiustra-creator.github.io/cieloromagna/dati.json";
const SITE = "cieloromagna.it";
const DRY = process.env.DRY === "1";           // solo stampa il messaggio, senza inviarlo
if (!TOKEN && !DRY) throw new Error("manca TELEGRAM_BOT_TOKEN");

// il workflow gira alle 5 e alle 6 UTC: le 7 italiane sono le 6 UTC d'inverno e le 5 d'estate, si invia solo dal cron giusto
if (MODE === "mattina" && process.env.SCHEDULE) {
  const romeHour = +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(new Date());
  const offset = (romeHour - new Date().getUTCHours() + 24) % 24;
  const want = (7 - offset + 24) % 24, cronHour = +process.env.SCHEDULE.split(" ")[1];
  if (cronHour !== want) { console.log(`cron delle ${cronHour} UTC: oggi le 7 italiane sono le ${want} UTC, non invio`); process.exit(0); }
}

const api = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {})
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
};

let chat = process.env.TELEGRAM_CHAT;
if (!chat && !DRY) {
  const ups = await api("getUpdates", { allowed_updates: ["my_chat_member", "channel_post"] });
  const ch = ups.map(u => u.my_chat_member?.chat ?? u.channel_post?.chat).filter(c => c?.type === "channel").at(-1);
  if (!ch) throw new Error("nessun canale trovato: aggiungi il bot come amministratore e riprova");
  chat = ch.username ? "@" + ch.username : ch.id;
  console.log(`canale trovato: ${ch.title} (${chat})`);
}

// località dal sito, per non tenere due elenchi
const tpl = await readFile("index.html", "utf8");
const PLACES = new Function(`return ${tpl.match(/const PLACES = (\[[\s\S]*?\n\]);/)[1]}`)();
const ZONES = Object.fromEntries([...tpl.matchAll(/(\w\d): \{ name: "([^"]+)"/g)].map(m => [m[1], m[2]]));
const GROUPS = [["costa", "🏖", "Costa"], ["pianura", "🌾", "Pianura"], ["collina", "⛰", "Collina"]];
const EVENTS = { "idraulica": "piene dei fiumi", "idrogeologica": "frane e piene dei corsi minori", "temporali": "temporali", "vento": "vento",
  "temperature-estreme": "temperature estreme", "neve": "neve", "ghiaccio-pioggia-gela": "ghiaccio e pioggia che gela", "stato-mare": "stato del mare", "mareggiate": "mareggiate" };
const RANK = { green: 0, yellow: 1, orange: 2, red: 3 }, COLOR = ["verde", "gialla", "arancione", "rossa"], DOT = ["🟢", "🟡", "🟠", "🔴"];
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const listIt = a => a.length <= 1 ? (a[0] ?? "") : a.slice(0, -1).join(", ") + " e " + a.at(-1);

const om = await (await fetch("https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
  latitude: PLACES.map(p => p.lat).join(","), longitude: PLACES.map(p => p.lon).join(","), timezone: "Europe/Rome", forecast_days: 2,
  daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max"
}))).json();
const daily = (Array.isArray(om) ? om : [om]).map(x => x.daily);
const dati = await (await fetch(DATI_URL + "?t=" + Date.now())).json().catch(() => null);

// per ogni gruppo di località: pioverà? (sì / forse / no) e la forbice di massime e minime
function groupDay(g, k) {
  const ds = PLACES.map((p, i) => ({ p, d: daily[i] })).filter(x => x.p.group === g);
  const prob = Math.max(...ds.map(x => x.d.precipitation_probability_max[k] ?? 0));
  const mm = Math.max(...ds.map(x => x.d.precipitation_sum[k] ?? 0));
  const codes = ds.map(x => x.d.weather_code[k]);
  const wet = ds.filter(x => (x.d.precipitation_sum[k] ?? 0) >= 1 || (x.d.precipitation_probability_max[k] ?? 0) >= 60);
  const mx = ds.map(x => Math.round(x.d.temperature_2m_max[k])), mn = ds.map(x => Math.round(x.d.temperature_2m_min[k]));
  const span = a => Math.min(...a) === Math.max(...a) ? `${a[0]}°` : `${Math.min(...a)}–${Math.max(...a)}°`;
  const t = `max ${span(mx)} · min ${span(mn)}`;
  const what = codes.some(c => c >= 95) ? "temporali" : codes.some(c => (c >= 71 && c <= 77) || c === 85 || c === 86) ? "neve" : "pioggia";
  let ans;
  if (wet.length) ans = `<b>sì</b>, ${what}${wet.length < ds.length ? " a " + listIt(wet.map(x => x.p.name)) : ""} (fino al ${prob}%)`;
  else if (prob >= 30 || mm >= 0.3) ans = `<b>forse</b> (${prob}%)`;
  else ans = "no";
  return `${ans} · ${t}`;
}

function alertsLine(day) {
  const zone = dati?.[day]?.zone ?? [];
  const hot = zone.map(z => ({ z, ev: Object.entries(z.eventi).filter(([, c]) => RANK[c] > 0) })).filter(x => x.ev.length);
  if (!dati?.[day]) return "dato non disponibile, guarda allertameteo.regione.emilia-romagna.it";
  if (!hot.length) return `${DOT[0]} nessuna allerta ${day}`;
  const worst = Math.max(...hot.flatMap(x => x.ev.map(([, c]) => RANK[c])));
  const ev = [...new Set(hot.flatMap(x => x.ev.filter(([, c]) => RANK[c] === worst).map(([e]) => EVENTS[e] ?? e)))];
  const zn = hot.filter(x => x.ev.some(([, c]) => RANK[c] === worst)).map(x => ZONES[x.z.area] ?? x.z.area);
  return `${DOT[worst]} <b>allerta ${COLOR[worst]} ${day}</b>: ${esc(listIt(ev))} (${esc(listIt(zn))})`;
}

function riversLine() {
  if (!dati?.fiumi) return "dato non disponibile";
  const st = dati.fiumi.flatMap(f => f.stazioni.map(s => ({ f: f.fiume, s, v: s.series.at(-1)?.[1] }))).filter(x => x.v != null);
  const over = st.map(x => ({ ...x, lvl: x.s.soglie.filter(t => t != null && x.v >= t).length })).filter(x => x.lvl > 0);
  if (!over.length) return `${DOT[0]} tutte le ${st.length} stazioni sotto la soglia 1`;
  const worst = Math.max(...over.map(x => x.lvl));
  return `${DOT[Math.min(3, worst)]} <b>${esc(listIt([...new Set(over.map(x => x.f))]))}</b> oltre la soglia (${over.length} ${over.length === 1 ? "stazione" : "stazioni"})`;
}

const today = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" });
const text = [
  MODE === "prova" ? "🧪 <i>Messaggio di prova</i>\n" : "",
  `☀️ <b>Buongiorno Romagna</b> · ${today}`,
  "",
  "<b>Pioverà oggi?</b>",
  ...GROUPS.map(([g, icon, name]) => `${icon} ${name}: ${groupDay(g, 0)}`),
  "",
  "<b>E domani?</b>",
  ...GROUPS.map(([g, icon, name]) => `${icon} ${name}: ${groupDay(g, 1)}`),
  "",
  `⚠️ Allerte: ${alertsLine("oggi")}`,
  `🌊 Fiumi: ${riversLine()}`,
  "",
  `👉 <a href="https://${SITE}/">${SITE}</a> · previsioni per la tua località`,
  `<i>Non è un servizio ufficiale: per le allerte fa fede Allerta Meteo Emilia-Romagna.</i>`
].filter((l, i) => !(i === 0 && l === "")).join("\n");

if (DRY) { console.log(text); process.exit(0); }
const msg = await api("sendMessage", { chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
console.log(`inviato a ${chat}, messaggio ${msg.message_id}`);
console.log(text);
