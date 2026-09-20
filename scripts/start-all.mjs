// One command to run everything locally: database + web app + scheduler.   npm run up
// Add "prod" to serve the production build instead of the dev server:      npm run up -- prod
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prod = process.argv.includes("prod");
const children = [];

try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  /* checked below */
}

// Until Supabase sign-in is configured, run locally without a login (ignored on Vercel or any non-localhost APP_BASE_URL).
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.env.AUTH_MODE = "dev";

function run(name, args, opts = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"], ...opts });
  const pipe = (stream) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) if (l.trim()) console.log(`[${name}] ${l}`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on("exit", (code) => console.log(`[${name}] exited (${code})`));
  children.push(child);
  return child;
}

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });

async function waitFor(port, label, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not start on port ${port}`);
}

function stopAll() {
  for (const c of children) {
    if (c.pid) spawnSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { stdio: "ignore" });
  }
  process.exit(0);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

if (!fs.existsSync(path.join(root, ".env"))) {
  console.error("No .env file. Copy .env.example to .env first.");
  process.exit(1);
}

if (await portOpen(54329)) console.log("[db] already running on 54329");
else {
  run("db", ["scripts/dev-db.mjs"]);
  await waitFor(54329, "Postgres");
}
spawnSync(process.execPath, ["--env-file=.env", "scripts/migrate.mjs"], { cwd: root, stdio: "inherit" });

if (await portOpen(3000)) console.log("[web] already running on 3000");
else {
  if (prod && !fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.log("[web] no production build yet, building…");
    const b = spawnSync(process.execPath, ["scripts/run-next.mjs", "build"], { cwd: root, stdio: "inherit" });
    if (b.status !== 0) process.exit(1);
  }
  run("web", ["scripts/run-next.mjs", prod ? "start" : "dev"]);
  await waitFor(3000, "the web app");
}
run("cron", ["--env-file=.env", "scripts/dev-cron.mjs"]);
console.log("\nDaybook is running: http://localhost:3000   (Ctrl+C stops everything this window started)\n");
setInterval(() => {}, 1 << 30);
