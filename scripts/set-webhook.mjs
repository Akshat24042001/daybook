// Registers the Telegram webhook with the secret token: npm run telegram:webhook
// Needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and an https APP_BASE_URL (your Vercel URL, or a tunnel while testing).
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const rawBase = process.env.APP_BASE_URL || "";
const base = (() => { try { return new URL(rawBase).origin; } catch { return rawBase.replace(/\/$/, ""); } })();
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

// Register bot commands so Telegram shows the command menu.
const cmds = await fetch(`${api}/bot${token}/setMyCommands`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    commands: [
      { command: "today",   description: "Today's task list" },
      { command: "score",   description: "Set day score — /score 8 or /score 8.5" },
      { command: "steps",   description: "Log step count — /steps 8500" },
      { command: "worked",  description: "Set hours worked — /worked 7.5h" },
      { command: "pause",   description: "Toggle exercise pings on/off" },
      { command: "help",    description: "All commands and quick text shortcuts" },
      { command: "start",   description: "Link this chat to your Daybook" },
    ],
  }),
}).then((r) => r.json());
console.log(cmds.ok ? "Bot commands registered." : `Commands failed: ${cmds.description}`);

process.exit(json.ok ? 0 : 1);
