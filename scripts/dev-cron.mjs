// Local stand-in for Supabase Cron: calls POST /api/cron/tick every minute with the secret header.
// (In production, Supabase pg_cron + pg_net does this. See db/cron.generated.sql.)
const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set.");
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(`${base}/api/cron/tick`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
      signal: AbortSignal.timeout(50_000),
    });
    const body = await res.json().catch(() => ({}));
    const sent = Array.isArray(body.sent) ? body.sent.length : 0;
    const errs = Array.isArray(body.errors) ? body.errors.length : 0;
    console.log(`${new Date().toISOString()} tick ${res.status}${sent ? ` sent=${sent}` : ""}${errs ? ` errors=${errs}` : ""}`);
    if (errs) console.log("  ", body.errors.slice(0, 3).join(" | "));
  } catch (e) {
    console.log(`${new Date().toISOString()} tick failed: ${e.message}`);
  }
}

console.log(`Ticking ${base}/api/cron/tick every 60s`);
await tick();
setInterval(tick, 60_000);
