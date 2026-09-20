// Seed data from PRD section 16: exercise types, projects, LinkedIn cadence task. Idempotent.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const client = new pg.Client({
  connectionString: url,
  ssl: /supabase\.(co|com)|pooler\.supabase/.test(url) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

const exercises = [
  ["Squats", 20, "reps"],
  ["Push-ups", 15, "reps"],
  ["Plank", 30, "seconds"],
];
let sort = 0;
for (const [name, amount, unit] of exercises) {
  sort += 1;
  await client.query(
    `insert into exercise_types (name, default_amount, unit, sort)
     select $1, $2, $3, $4 where not exists (select 1 from exercise_types where lower(name) = lower($1))`,
    [name, amount, unit, sort],
  );
}

const projects = [
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
   where not exists (select 1 from tasks where lower(title) = 'linkedin post' and type = 'cadence')`,
);

console.log("seed complete");
await client.end();
