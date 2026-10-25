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
  hourly: "precipitation_probability,precipitation,weather_code",
  daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset"
}))).json();
const OM = Array.isArray(om) ? om : [om];
const dati = await (await fetch(DATI_URL + "?t=" + Date.now())).json().catch(() => null);

const SNOW = c => (c >= 71 && c <= 77) || c === 85 || c === 86;
const FOG = c => c === 45 || c === 48;
const PERIODS = [[0, 6, "di notte"], [6, 12, "al mattino"], [12, 18, "nel pomeriggio"], [18, 24, "in serata"]];
const WHERE = { costa: "sulla costa", pianura: "in pianura", collina: "in collina" };
const nowHour = +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(new Date());
// icona del gruppo: il tempo più "importante" tra le località (pioggia e simili prima del cielo)
function emoji(codes, wet) {
  if (codes.some(c => c >= 95)) return "⛈";
  if (codes.some(SNOW)) return "🌨";
  if (wet) return "🌧";
  const n = f => codes.filter(f).length;
  if (n(FOG) * 2 >= codes.length) return "🌫";
  if (n(c => c === 3) * 2 >= codes.length) return "☁️";
  if (n(c => c <= 1) * 2 >= codes.length) return "☀️";
  return "⛅";
}

// le città nel messaggio, una riga ciascuna; costa, pianura e collina restano nella frase di riassunto
const CITIES = ["rimini", "ravenna", "cesena", "forli", "faenza", "imola"];

// una o più località in un giorno (k = 0 oggi, 1 domani), dall'ora "from" in poi
const group = (g, k, from) => info(p => p.group === g, k, from, g);
function info(pick, k, from, g) {
  const ps = PLACES.map((p, i) => ({ p, o: OM[i] })).filter(x => pick(x.p));
  const date = ps[0].o.daily.time[k];
  const hours = ps.map(x => x.o.hourly.time.map((t, j) => ({ t, j })).filter(q => q.t.startsWith(date) && +q.t.slice(11, 13) >= from)
    .map(({ t, j }) => ({ h: +t.slice(11, 13), prob: x.o.hourly.precipitation_probability[j] ?? 0, mm: x.o.hourly.precipitation[j] ?? 0, code: x.o.hourly.weather_code[j] })));
  // un periodo è piovoso se piove in almeno un terzo delle località del gruppo
  const per = PERIODS.map(([a, b, label]) => {
    const each = hours.map(l => l.filter(q => q.h >= a && q.h < b)).filter(l => l.length);
    if (!each.length) return null;
    const wet = each.filter(l => Math.max(...l.map(q => q.prob)) >= 50 || l.reduce((s, q) => s + q.mm, 0) >= 1).length;
    return { label, wet: wet * 3 >= each.length, maybe: each.some(l => Math.max(...l.map(q => q.prob)) >= 30), prob: Math.max(...each.flat().map(q => q.prob)) };
  }).filter(Boolean);
  const codes = hours.flat().map(q => q.code);
  const wetP = per.filter(p => p.wet), maybeP = per.filter(p => p.maybe);
  const fogMorning = hours.filter(l => l.some(q => q.h >= 5 && q.h < 12 && FOG(q.code))).length * 2 >= ps.length;
  const tmax = Math.max(...ps.map(x => Math.round(x.o.daily.temperature_2m_max[k])));
  const tmin = Math.min(...ps.map(x => Math.round(x.o.daily.temperature_2m_min[k])));
  const gust = Math.max(...ps.map(x => x.o.daily.wind_gusts_10m_max[k] ?? 0));
  const what = codes.some(c => c >= 95) ? "temporali" : codes.some(SNOW) ? "neve" : "pioggia";
  let text;
  if (wetP.length) {
    const when = wetP.length === per.length && per.length > 2 ? "per gran parte della giornata" : listIt(wetP.map(p => p.label));
    text = what + " " + when + " (fino al " + Math.max(...wetP.map(p => p.prob)) + "%)";
  } else if (maybeP.length) {
    text = "qualche pioggia possibile " + listIt(maybeP.map(p => p.label)) + " (" + Math.max(...maybeP.map(p => p.prob)) + "%)";
  } else text = "asciutto";
  const extra = [fogMorning && !wetP.length ? "nebbia al mattino" : "", tmin <= 0 ? "gelate" : tmin <= 2 ? "possibili brinate" : "",
    gust >= 50 ? "raffiche fino a " + Math.round(gust) + " km/h" : ""].filter(Boolean);
  return { g, wet: wetP.length > 0, maybe: !wetP.length && maybeP.length > 0, what, periods: wetP.map(p => p.label), fog: fogMorning,
    icon: emoji(codes, wetP.length > 0), text: [text, ...extra].join(", "), tmax, tmin };
}

// frase di riassunto della giornata su tutta la Romagna
function summary(gs) {
  const wet = gs.filter(x => x.wet), maybe = gs.filter(x => x.maybe), fog = gs.filter(x => x.fog && !x.wet);
  if (wet.length) {
    const what = wet.some(x => x.what === "temporali") ? "Temporali" : wet.some(x => x.what === "neve") ? "Neve" : "Pioggia";
    const when = [...new Set(wet.flatMap(x => x.periods))];
    return what + " " + (wet.length === gs.length ? "su tutta la Romagna" : listIt(wet.map(x => WHERE[x.g])))
      + (when.length && when.length < 3 ? ", soprattutto " + listIt(when) : "") + ".";
  }
  if (maybe.length) return "Qualche pioggia possibile " + listIt(maybe.map(x => WHERE[x.g])) + ", per il resto asciutto.";
  return "Giornata asciutta" + (fog.length ? ", con nebbia al mattino " + listIt(fog.map(x => WHERE[x.g])) : "") + ".";
}

function alertsLine() {
  if (!dati?.oggi) return "dato non disponibile, guarda allertameteo.regione.emilia-romagna.it";
  const parts = ["oggi", "domani"].map(day => {
    const hot = (dati[day]?.zone ?? []).map(z => ({ z, ev: Object.entries(z.eventi).filter(([, c]) => RANK[c] > 0) })).filter(x => x.ev.length);
    if (!hot.length) return null;
    const worst = Math.max(...hot.flatMap(x => x.ev.map(([, c]) => RANK[c])));
    const ev = [...new Set(hot.flatMap(x => x.ev.filter(([, c]) => RANK[c] === worst).map(([e]) => EVENTS[e] ?? e)))];
    const zn = hot.filter(x => x.ev.some(([, c]) => RANK[c] === worst)).map(x => ZONES[x.z.area] ?? x.z.area);
    return DOT[worst] + " <b>allerta " + COLOR[worst] + " " + day + "</b>: " + esc(listIt(ev)) + " (" + esc(listIt(zn)) + ")";
  }).filter(Boolean);
  return parts.length ? parts.join("\n") : DOT[0] + " nessuna allerta oggi né domani";
}

function riversLine() {
  if (!dati?.fiumi) return "dato non disponibile";
  const st = dati.fiumi.flatMap(f => f.stazioni.map(s => ({ f: f.fiume, s, v: s.series.at(-1)?.[1] }))).filter(x => x.v != null);
  const over = st.map(x => ({ ...x, lvl: x.s.soglie.filter(t => t != null && x.v >= t).length })).filter(x => x.lvl > 0);
  if (!over.length) return DOT[0] + " tutti sotto la soglia 1";
  const worst = Math.max(...over.map(x => x.lvl));
  return DOT[Math.min(3, worst)] + " <b>" + esc(listIt([...new Set(over.map(x => x.f))])) + "</b> oltre la soglia ("
    + over.length + " " + (over.length === 1 ? "stazione" : "stazioni") + ")";
}

const oggi = GROUPS.map(([g]) => group(g, 0, Math.min(nowHour, 21)));
const domani = GROUPS.map(([g]) => group(g, 1, 0));
const ref = OM[PLACES.findIndex(p => p.id === "forli")]?.daily ?? OM[0].daily;
const today = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" });
const tomorrowText = summary(domani).replace(/^Giornata asciutta/, "asciutto").replace(/^./, c => c.toLowerCase()).replace(/\.$/, "");
const text = [
  MODE === "prova" ? "🧪 <i>Messaggio di prova</i>\n" : "",
  "☀️ <b>Buongiorno Romagna</b> · " + today,
  "<i>" + esc(summary(oggi)) + "</i>",
  "",
  ...CITIES.map(id => {
    const p = PLACES.find(x => x.id === id), c = info(x => x.id === id, 0, Math.min(nowHour, 21));
    return c.icon + " <b>" + p.name + "</b> ↑" + c.tmax + "° ↓" + c.tmin + "° · " + esc(c.text);
  }),
  "",
  "📅 <b>Domani</b>: " + esc(tomorrowText) + " · ↑" + Math.max(...domani.map(x => x.tmax)) + "° ↓" + Math.min(...domani.map(x => x.tmin)) + "°",
  "",
  "⚠️ <b>Allerte</b>: " + alertsLine(),
  "🌊 <b>Fiumi</b>: " + riversLine(),
  "🌅 Alba " + ref.sunrise[0].slice(11, 16) + " · tramonto " + ref.sunset[0].slice(11, 16),
  "",
  '👉 <a href="https://' + SITE + '/">Le previsioni per la tua località su ' + SITE + "</a>"
].filter((l, i) => !(i === 0 && l === "")).join("\n");

if (DRY) { console.log(text); process.exit(0); }
const msg = await api("sendMessage", { chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
console.log(`inviato a ${chat}, messaggio ${msg.message_id}`);
console.log(text);
