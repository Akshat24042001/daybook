// Local Postgres for development and tests. Same engine as Supabase, no Docker needed.
// Data lives in .pgdata (a junction to C: on this machine because D: is nearly full).
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".pgdata", "data");
const port = Number(process.env.DEV_DB_PORT || 54329);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error("[pg]", String(e).trim()),
});

if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.log("Initialising new Postgres cluster in", dataDir);
  await pg.initialise();
}
await pg.start();

for (const name of ["daybook", "daybook_test"]) {
  try {
    await pg.createDatabase(name);
    console.log("created database", name);
  } catch (e) {
    if (!/already exists/i.test(String(e?.message ?? e))) throw e;
  }
}
console.log(`Postgres ready on postgres://postgres:postgres@127.0.0.1:${port}/daybook`);

const stop = async () => {
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
