/**
 * Runs once on every cold start (via src/instrumentation.ts).
 * Order: migrations → seed defaults → Telegram webhook.
 * All steps are idempotent and fail-safe.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

function dbClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return new pg.Client({
    connectionString: url,
    ssl: /supabase\.(co|com)|pooler\.supabase/.test(url) ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10_000,
  });
}

function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit && explicit !== "http://localhost:3000") return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return explicit ?? "";
}

async function runMigrations(client: pg.Client) {
  const migrationsDir = path.join(process.cwd(), "db", "migrations");
  if (!fs.existsSync(migrationsDir)) return;

  await client.query(
    `create table if not exists schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );

  const applied = new Set(
    (await client.query("select name from schema_migrations")).rows.map((r: { name: string }) => r.name),
  );

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    console.log(`[bootstrap] applying migration ${f}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [f]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  console.log("[bootstrap] migrations up to date");
}

async function runSeed(client: pg.Client) {
  const exercises: [string, number, string][] = [
    ["Squats", 20, "reps"],
    ["Push-ups", 15, "reps"],
    ["Plank", 30, "seconds"],
  ];
  let sort = 0;
  for (const [name, amount, unit] of exercises) {
    sort += 1;
    await client.query(
      `insert into exercise_types (name, default_amount, unit, sort)
       select $1, $2, $3, $4 where not exists (
         select 1 from exercise_types where lower(name) = lower($1)
       )`,
      [name, amount, unit, sort],
    );
  }

  const projects: [string, string][] = [
    ["Vector", "#6366f1"],
    ["DRAC", "#f59e0b"],
  ];
  for (const [name, color] of projects) {
    await client.query(
      "insert into projects (name, color) values ($1, $2) on conflict (lower(name)) do nothing",
      [name, color],
    );
  }

  await client.query(
    `insert into tasks (title, type, cadence_days)
     select 'LinkedIn post', 'cadence', 7
     where not exists (
       select 1 from tasks where lower(title) = 'linkedin post' and type = 'cadence'
     )`,
  );
  console.log("[bootstrap] seed up to date");
}

async function registerWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const base = appBaseUrl();

  if (!token || !secret) return;
  if (!base.startsWith("https://")) {
    console.log("[bootstrap] APP_BASE_URL not https — Telegram webhook will register after deploy");
    return;
  }

  const webhookUrl = `${base}/api/telegram`;
  const check = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = (await check.json()) as { ok: boolean; result?: { url: string } };
  if (info.ok && info.result?.url === webhookUrl) {
    console.log("[bootstrap] Telegram webhook already set");
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, secret_token: secret }),
  });
  const body = (await res.json()) as { ok: boolean; description?: string };
  if (body.ok) console.log(`[bootstrap] Telegram webhook → ${webhookUrl}`);
  else console.warn("[bootstrap] Telegram webhook failed:", body.description);
}

export async function bootstrap() {
  if (!process.env.DATABASE_URL) {
    console.warn("[bootstrap] DATABASE_URL not set — skipping");
    return;
  }

  const client = dbClient();
  try {
    await client.connect();
    await runMigrations(client);
    await runSeed(client);
  } finally {
    await client.end().catch(() => {});
  }

  await registerWebhook().catch((e: Error) =>
    console.warn("[bootstrap] webhook step failed:", e.message),
  );
}
