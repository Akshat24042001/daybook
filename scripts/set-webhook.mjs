// Registers the Telegram webhook with the secret token: npm run telegram:webhook
// Needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and an https APP_BASE_URL (your Vercel URL, or a tunnel while testing).
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
const api = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");
if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is not set.");
if (!/^https:\/\//.test(base)) throw new Error(`APP_BASE_URL must be an https address (currently "${base}"). Telegram only delivers webhooks to https.`);

const res = await fetch(`${api}/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: `${base}/api/telegram`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  }),
});
const json = await res.json();
console.log(json.ok ? `Webhook set to ${base}/api/telegram` : `Telegram said: ${json.description}`);

const info = await fetch(`${api}/bot${token}/getWebhookInfo`).then((r) => r.json());
if (info.ok) {
  const { url, pending_update_count, last_error_message } = info.result;
  console.log(`Registered URL: ${url}`);
  console.log(`Pending updates: ${pending_update_count}${last_error_message ? `, last error: ${last_error_message}` : ""}`);
}
process.exit(json.ok ? 0 : 1);
