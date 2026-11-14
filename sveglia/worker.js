// Sveglia del messaggio Telegram del mattino. Le schedule di GitHub arrivano con ore di ritardo,
// i Cron Trigger di Cloudflare no: alle 6 di Roma questo Worker lancia telegram.yml in modo "mattina".
// I cron sono in UTC (4 e 5): parte solo quello che a Roma cade alle 6, così vale con ora legale e solare.
// Secret GITHUB_TOKEN: token fine-grained solo sul repo cieloromagna, permesso Actions in scrittura.
//
// Fa anche da ripiego per Open-Meteo: il 14/11 i runner GitHub non riuscivano a collegarsi ad api.open-meteo.com
// (timeout per ore) mentre da altre reti rispondeva. Su cieloromagna.it/om/v1/forecast?... il Worker gira la
// richiesta a Open-Meteo dalla rete Cloudflare. Serve l'header x-chiave uguale al secret OM_CHIAVE (che sta anche
// nei secret del repo), così non diventa un proxy aperto.
const REPO = "lucagiustra-creator/cieloromagna";

async function lancia(env) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/telegram.yml/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "cieloromagna-sveglia",
      "x-github-api-version": "2022-11-28"
    },
    body: JSON.stringify({ ref: "main", inputs: { modo: "mattina" } })
  });
  if (r.status !== 204) throw new Error(`GitHub ha risposto ${r.status}: ${await r.text()}`);
}

async function openMeteo(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/om/v1/forecast") return new Response("non trovato", { status: 404 });
  if (!env.OM_CHIAVE || request.headers.get("x-chiave") !== env.OM_CHIAVE) return new Response("vietato", { status: 403 });
  const r = await fetch("https://api.open-meteo.com/v1/forecast" + url.search, { headers: { "user-agent": "cieloromagna" } });
  return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json" } });
}

export default {
  async scheduled(event, env, ctx) {
    const ora = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "numeric", hourCycle: "h23" })
      .format(new Date(event.scheduledTime));
    if (Number(ora) !== 6) return console.log(`a Roma sono le ${ora}, non è il mio turno`);
    await lancia(env);
    console.log("telegram.yml lanciato");
  },
  fetch: openMeteo
};
