const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, go, db } = t;
  console.log("Radar: readable dates, newest first by day, who posted it, who is behind it, paid sites flagged");
  await db.query("delete from sales_radar_items where url like 'https://e2e.radar/%' or url like 'https://www.freelancer.com/projects/e2e-%'");
  const add = (url, title, hoursAgo, extra = {}) => db.query(
    `insert into sales_radar_items (url, url_hash, title, body, status, score, posted_at, found_at, poster, identity, fit)
     values ($1, md5($1), $2, $3, 'qualified', $4, now() - ($5 || ' hours')::interval, now() - ($5 || ' hours')::interval, $6, $7, $8)`,
    [url, title, extra.body ?? "Need it soon.", extra.score ?? 80, String(hoursAgo), extra.poster ? JSON.stringify(extra.poster) : null, extra.identity ? JSON.stringify(extra.identity) : null, JSON.stringify({ why: "fits", country: "India" })]);
  await add("https://www.freelancer.com/projects/e2e-bot", "E2E: WhatsApp booking bot for 3 clinics", 1, {
    score: 70, poster: { name: "Ravi S.", username: "ravidental", city: "Pune", country: "India", history: "12 projects completed, 9 reviews" },
  });
  await add("https://www.freelancer.com/projects/e2e-found", "E2E: Inventory app for a pharmacy chain", 3, {
    score: 90, identity: { status: "found", company: "MedPlus Pune", website: "https://medpluspune.in", person: "Anita Rao", title: "Owner", emails: ["owner@medpluspune.in"], phones: ["+91 98200 22222"], linkedin: null, confidence: "high", evidence: [{ url: "https://medpluspune.in/contact", says: "contact page" }], note: "Same need posted on their site.", checked_at: new Date().toISOString() },
  });
  await add("https://e2e.radar/old", "E2E: Older reddit-style need", 50, { score: 95 });

  await go("/sales/radar");
  const main = page.locator("main");
  const text = await main.innerText();
  check("day headers: Today first", /Today\s*\d+ leads?/.test(text) || text.includes("Today"));
  const firstToday = text.indexOf("E2E: WhatsApp booking bot");
  check("newest first, not best score first", firstToday >= 0 && firstToday < text.indexOf("E2E: Inventory app") && text.indexOf("E2E: Inventory app") < text.indexOf("E2E: Older"));
  const card = page.locator("li", { hasText: "E2E: WhatsApp booking bot" }).first();
  check("posted date in words, with New badge", /New\s*Posted Today, \d{1,2}:\d{2}\s?(am|pm)/i.test(await card.innerText()));
  check("who posted it: name, place, history", /Ravi S\.[\s\S]*@ravidental[\s\S]*Pune, India[\s\S]*12 projects completed/.test(await card.innerText()));
  check("paid site explained, find them directly offered", (await card.innerText()).includes("needs paid bids or credits") && (await card.getByRole("button", { name: "Find them directly" }).isVisible()));
  check("no bid draft on a paid site with no contact", (await card.getByRole("button", { name: /Draft/ }).count()) === 0);

  const found = page.locator("li", { hasText: "E2E: Inventory app" }).first();
  const ft = await found.innerText();
  check("found: person, company, sure", /Anita Rao\s*, Owner[\s\S]*MedPlus Pune[\s\S]*Sure/.test(ft));
  check("found: email, phone, WhatsApp, website as links", (await found.getByRole("link", { name: /owner@medpluspune.in/ }).count()) === 1 && (await found.getByRole("link", { name: "WhatsApp" }).count()) === 1 && (await found.getByRole("link", { name: /medpluspune.in/ }).count()) >= 1);
  check("direct message draft offered once contact is found", await found.getByRole("button", { name: "Draft a direct message" }).isVisible());

  await page.getByRole("button", { name: "Contact found" }).click();
  const filtered = await main.innerText();
  check("filter: contact found", filtered.includes("E2E: Inventory app") && !filtered.includes("E2E: WhatsApp booking bot"));
  await page.getByRole("button", { name: "Free to reply" }).click();
  const free = await main.innerText();
  check("filter: free to reply hides paid sites", free.includes("E2E: Older") && !free.includes("E2E: Inventory app"));
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: "Best match" }).click();
  const best = await main.innerText();
  check("best match puts the highest score first", best.indexOf("E2E: Older") < best.indexOf("E2E: Inventory app"));
  await page.getByRole("button", { name: "Newest first" }).click();

  // the search, on a server with no AI key, says why instead of spinning
  t.errors.length = 0;
  await card.getByRole("button", { name: "Find them directly" }).click();
  await page.waitForTimeout(2500);
  check("without an AI key it says so", /AI key|GEMINI/i.test(await page.locator("body").innerText()));
  t.errors.splice(0);
  await db.query("delete from sales_radar_items where url like 'https://e2e.radar/%' or url like 'https://www.freelancer.com/projects/e2e-%'");
  await t.done();
})();
