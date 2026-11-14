const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup({ width: 1440, height: 1000 });
  const { page, one, go, db } = t;
  console.log("Radar board: Do first order, unread, plain-language brief, one-click contacts, duplicates merged, filters, keys");
  const clean = () => db.query("delete from sales_radar_items where url like 'https://e2e.radar/%' or url like 'https://www.freelancer.com/projects/e2e-%'");
  await clean();
  await db.query("update sales_radar_items set hidden = true where status = 'qualified'"); // only this test's leads in view
  const add = (url, title, hoursAgo, extra = {}) => one(
    `insert into sales_radar_items (url, url_hash, title, body, status, score, posted_at, found_at, poster, identity, fit, brief)
     values ($1, md5($1), $2, $3, 'qualified', $4, now() - ($5 || ' hours')::interval, now() - ($5 || ' hours')::interval, $6, $7, $8, $9) returning id`,
    [url, title, extra.body ?? "We need this built soon. Budget is flexible for the right team.", extra.score ?? 80, String(hoursAgo),
      extra.poster ? JSON.stringify(extra.poster) : null, extra.identity ? JSON.stringify(extra.identity) : null,
      JSON.stringify({ why: "fits", country: "India", ...(extra.fit ?? {}) }), extra.brief ? JSON.stringify(extra.brief) : null]);
  const found = await add("https://www.freelancer.com/projects/e2e-found", "E2E: Inventory app for a pharmacy chain", 2, {
    score: 85,
    identity: { status: "found", company: "MedPlus Pune", website: "https://medpluspune.in", person: "Dr Anita Rao", title: "Owner", emails: ["owner@medpluspune.in"], phones: ["+91 98200 22222"], linkedin: null, confidence: "high", evidence: [], note: "Same need on their site.", checked_at: new Date().toISOString() },
    brief: {
      need: "A pharmacy chain with 6 stores wants one app to track stock across stores and reorder before items run out.",
      deliverables: ["Stock tracking across 6 stores", "Low-stock alerts", "Reorder suggestions"], help: ["Start with a 2-week pilot in one store", "Connect their billing software for live stock"],
      offers: ["Custom software"], questions: ["Which billing software do they use?", "How many items per store?"], opener: "Saw you want stock tracked across your six stores.",
      size: "medium", budget: "INR 50,000 to 1,00,000", timing: "within a month", watch_out: null, made_at: new Date().toISOString(),
    },
  });
  const paidOld = await add("https://www.freelancer.com/projects/e2e-paid", "E2E: Logo animation", 30, { score: 95 });
  const free = await add("https://e2e.radar/reddit-1", "E2E: Need a WhatsApp bot for my salon (USD 200)", 1, { score: 70, fit: { urgency: "high" } });
  await add("https://e2e.radar/reddit-2", "E2E: Need a WhatsApp bot for my salon (USD 300)", 3, { score: 60 }); // the same need, found twice

  await go("/sales/radar");
  const list = page.getByRole("listbox", { name: "Leads" });
  const rows = async () => (await list.getByRole("option").allInnerTexts()).filter((x) => x.includes("E2E:"));
  const r0 = await rows();
  check("Do first: a fresh lead you can reach beats a higher score posted yesterday on a paid site", r0[0]?.includes("Inventory app") && r0.findIndex((x) => x.includes("Logo animation")) > r0.findIndex((x) => x.includes("salon")), r0.map((x) => x.split("\n").find((l) => l.includes("E2E:"))));
  check("the same need found twice shows once", r0.filter((x) => x.includes("salon")).length === 1 && r0.find((x) => x.includes("salon")).includes("+1 more source"));
  check("rows show contact icons and the plain need", /email[\s\S]*phone/.test(r0[0]) && r0[0].includes("pharmacy chain with 6 stores"));
  check("unread leads are marked (the one that opened by itself is read)", (await list.locator('[aria-label="Unread"]').count()) === 2);

  const pane = page.getByRole("article", { name: "Selected lead" }).first();
  await pane.waitFor();
  const pt = await pane.innerText();
  check("first lead opens on the right by itself", pt.includes("E2E: Inventory app") && pt.includes("#1 to do"));
  check("what they need, in plain words, with deliverables and budget", /What they need[\s\S]*pharmacy chain with 6 stores[\s\S]*Low-stock alerts[\s\S]*INR 50,000/i.test(pt));
  check("how you can help, with the opener", /How you can help[\s\S]*2-week pilot[\s\S]*Open with[\s\S]*six stores/i.test(pt));
  check("questions to ask", /Ask them[\s\S]*billing software/i.test(pt));
  const email = pane.getByRole("link", { name: /Email owner@medpluspune.in/ });
  const href = await email.getAttribute("href");
  check("one-click email, addressed by first name, with the opener", href.startsWith("mailto:owner@medpluspune.in") && decodeURIComponent(href).includes("Hi Anita,") && decodeURIComponent(href).includes("six stores"));
  check("one-click call and WhatsApp", (await pane.getByRole("link", { name: /Call \+91 98200 22222/ }).count()) === 1 && (await pane.getByRole("link", { name: "WhatsApp" }).first().getAttribute("href")).startsWith("https://wa.me/919820022222?text="));
  check("open the post", (await pane.getByRole("link", { name: /Open the post/ }).getAttribute("href")) === "https://www.freelancer.com/projects/e2e-found");
  await page.waitForTimeout(800);
  check("opening a lead marks it read", !!(await one("select seen_at from sales_radar_items where id = $1", [found.id])).seen_at);

  // keyboard: j moves to the next lead
  await page.keyboard.press("j");
  await page.waitForTimeout(500);
  check("j moves to the next lead", (await pane.innerText()).includes("salon"));
  check("no AI key: the brief says why, the scorer's line still shows", /AI key|GEMINI/i.test(await pane.innerText()));
  // skip it: gone from the list, the next one opens
  await pane.getByRole("button", { name: "Skip" }).click();
  await page.waitForTimeout(1200);
  check("skip removes it (both copies) and opens the next", !(await rows()).some((x) => x.includes("salon")) && (await one("select count(*)::int n from sales_radar_items where url like 'https://e2e.radar/reddit-%' and status = 'skipped'")).n === 2 && !!free);

  await page.getByRole("button", { name: "Contact found" }).click();
  check("filter: contact found", (await rows()).length === 1 && (await rows())[0].includes("Inventory app"));
  await page.getByRole("button", { name: "Free to reply" }).click();
  check("filter: free to reply hides paid sites", !(await rows()).some((x) => x.includes("Inventory app") || x.includes("Logo animation")));
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: "Newest" }).click();
  check("newest order", (await rows())[0].includes("Inventory app") && (await rows()).at(-1).includes("Logo animation"));
  await page.getByRole("button", { name: /^Unread/ }).click();
  check("unread view leaves out what you opened", !(await rows()).some((x) => x.includes("Inventory app")));

  // phone width: the list, and a sheet for the lead
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "All", exact: true }).click();
  await list.getByRole("option").filter({ hasText: "Logo animation" }).click();
  await page.waitForTimeout(500);
  check("on a phone the lead opens in a sheet", await page.getByRole("dialog").getByRole("article", { name: "Selected lead" }).isVisible());
  check("paid site with no contact: no bid draft, Find them directly offered", (await page.getByRole("dialog").getByRole("button", { name: /Draft/ }).count()) === 0 && (await page.getByRole("dialog").getByRole("button", { name: "Find them directly" }).count()) === 1);
  t.errors.splice(0); // the brief request without an AI key logs a failed request in the browser
  await clean();
  await db.query("update sales_radar_items set hidden = false where status = 'qualified' and hidden");
  void paidOld;
  await t.done();
})();
