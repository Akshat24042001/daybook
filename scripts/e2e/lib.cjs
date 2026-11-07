// Shared helpers for the browser checks: a logged-in page, a db client, and a strict check() that records failures.
const { chromium } = require("playwright");
const { Client } = require("pg");
const U = "http://localhost:3100";
const fails = [];
let passed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log("  ok  ", name); }
  else { fails.push(name); console.log("  FAIL", name, detail === undefined ? "" : JSON.stringify(detail)); }
}

async function setup(viewport = { width: 1440, height: 1000 }) {
  const db = new Client({ connectionString: "postgres://postgres:postgres@127.0.0.1:54329/daybook_ui" });
  await db.connect();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport });
  await ctx.request.post(U + "/api/auth/login", { data: { password: "pw" } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
  page.on("dialog", (d) => d.accept(page.__dialogAnswer ?? undefined));
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const all = async (sql, params = []) => (await db.query(sql, params)).rows;
  const go = async (path) => { await page.goto(U + path, { waitUntil: "networkidle" }); await page.waitForTimeout(300); };
  const done = async () => {
    check("no browser console errors", errors.length === 0, errors);
    console.log(`\n${passed} passed, ${fails.length} failed${fails.length ? ": " + fails.join(" | ") : ""}`);
    await browser.close(); await db.end();
    process.exit(fails.length ? 1 : 0);
  };
  return { page, ctx, db, one, all, go, done, errors };
}

/** Picks an option in the app's custom select (a button with role=combobox and a listbox). */
async function choose(page, combo, optionText) {
  await combo.click();
  await page.getByRole("option", { name: optionText }).first().click();
  await page.waitForTimeout(150);
}

module.exports = { setup, check, choose, U };
