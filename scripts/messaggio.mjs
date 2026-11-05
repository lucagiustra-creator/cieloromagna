// Messaggio libero nel canale Telegram di Cielo Romagna (es. considerazioni sul weekend), lanciato a mano
// dal workflow messaggio.yml. Il testo arriva in TESTO, in HTML di Telegram (<b>, <i>, <a href>);
// la sequenza "\n" scritta a mano vale come a capo. DRY=1 stampa senza inviare.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT || "@cieloromagna";
const text = (process.env.TESTO || "").replace(/\n/g, "\n").trim();
if (!text) throw new Error("manca il testo");
if (process.env.DRY === "1") { console.log(text); process.exit(0); }
if (!TOKEN) throw new Error("manca TELEGRAM_BOT_TOKEN");
const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } })
});
const j = await r.json();
if (!j.ok) throw new Error(`sendMessage: ${j.description}`);
console.log(`inviato a ${chat}, messaggio ${j.result.message_id}`);
console.log(text);
