const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, all, go, db } = t;
  console.log("Do not contact and known contacts");
  await db.query("delete from sales_blocklist");
  await db.query("delete from sales_radar_items where url_hash like 'e2e-%'");
  await db.query("delete from sales_deals where title in ('Echo CRM')");
  await db.query("delete from sales_companies where name in ('Echo Systems')");
  const co = (await one("insert into sales_companies (name, domain, website) values ('Echo Systems','echo.io','https://echo.io') returning id")).id;
  const deal = (await one("insert into sales_deals (title, stage_id, company_id) select 'Echo CRM', id, $1 from sales_stages where role = 'engaged' returning id", [co])).id;
  await db.query(`insert into sales_radar_items (url_hash, title, status, score, fit, found_at) values
    ('e2e-1','Echo Systems is hiring three data entry clerks','qualified',82,'{"company":"Echo Systems","website":"https://echo.io/careers","why":"manual work"}', now()),
    ('e2e-2','Foxtrot Labs needs a booking bot','qualified',88,'{"company":"Foxtrot Labs","website":"foxtrot.dev"}', now()),
    ('e2e-3','Golf Corp wants a CRM cleanup','qualified',77,'{"company":"Golf Corp Pvt Ltd"}', now())`);
  const id = async (h) => (await one("select id from sales_radar_items where url_hash = $1", [h])).id;

  // 1. block a domain from the Playbook: matching waiting leads are dropped at once, others get screened (known tagged)
  await go("/sales/playbook");
  const dnc = page.locator("section#dnc");
  await dnc.getByLabel("Value").fill("https://www.foxtrot.dev/about");
  await dnc.getByLabel("Reason").fill("asked us to stop");
  await dnc.getByRole("button", { name: "Add" }).click();
  await page.waitForTimeout(1500);
  const b = await all("select kind, value, reason from sales_blocklist");
  check("domain stored in canonical form", b.length === 1 && b[0].kind === "domain" && b[0].value === "foxtrot.dev" && b[0].reason === "asked us to stop", b);
  await dnc.getByText("https://www.foxtrot.dev/about", { exact: true }).waitFor({ timeout: 8000 }).catch(() => {});
  check("list shows the entry as typed", (await dnc.getByText("https://www.foxtrot.dev/about", { exact: true }).count()) === 1);
  const r2 = await one("select status, blocked from sales_radar_items where url_hash = 'e2e-2'");
  check("matching radar lead dropped with the reason", r2.status === "rejected" && /do-not-contact.*foxtrot\.dev.*asked us to stop/.test(r2.blocked), r2);
  const r1 = await one("select known, blocked from sales_radar_items where url_hash = 'e2e-1'");
  check("known company tagged with its deal", r1.blocked === null && r1.known?.deal_id === deal && r1.known?.why === "same website domain", r1);
  // a bad value is refused with a clear message
  await dnc.getByLabel("Kind").click();
  await page.getByRole("option", { name: "Person (full name)" }).click();
  await dnc.getByLabel("Value").fill("Ravi");
  await dnc.getByRole("button", { name: "Add" }).click();
  await page.waitForTimeout(1000);
  check("single first name refused with a message", (await page.getByText(/single first name is too vague/).count()) > 0);

  // 2. radar page: known badge, blocked lead gone from Qualified, "Never contact" on another
  await go("/sales/radar");
  const card1 = page.locator("li", { hasText: "Echo Systems is hiring three data entry clerks" });
  check("radar shows 'You already know them' with the deal link", (await card1.getByText(/You already know them \(same website domain\)/).count()) === 1 && (await card1.locator(`a[href="/sales/deal/${deal}"]`).count()) === 1);
  check("radar says making it a lead adds to that deal", (await card1.getByText(/adds it to that deal/).count()) === 1);
  check("blocked lead not in the Qualified list", (await page.locator("li", { hasText: "Foxtrot Labs needs a booking bot" }).count()) === 0);
  await go("/sales"); // the Moves page rebuilds the move list, as the background tick does
  await go("/sales/radar");
  const moves = await all("select title, why from sales_moves where status = 'open' and radar_item_id in ($1,$2)", [await id("e2e-1"), await id("e2e-2")]);
  check("known lead's move says so; blocked lead has no move", moves.length === 1 && moves[0].title.startsWith("Known contact:"), moves);

  const card3 = page.locator("li", { hasText: "Golf Corp wants a CRM cleanup" });
  await card3.getByRole("button", { name: "Never contact" }).click();
  await page.waitForTimeout(1500);
  const r3 = await one("select status, blocked from sales_radar_items where url_hash = 'e2e-3'");
  check("Never contact blocks the company and drops the lead, showing the name as written", r3.status === "rejected" && /company: Golf Corp Pvt Ltd, from radar/.test(r3.blocked), r3);
  check("blocklist matches on the canonical name, shows what was typed", (await all("select 1 from sales_blocklist where kind = 'company' and value = 'golf' and raw = 'Golf Corp Pvt Ltd'")).length === 1);

  // 3. making the known lead a lead adds it to the existing deal
  await go("/sales/radar");
  const before = (await one("select count(*)::int as n from sales_deals")).n;
  await page.locator("li", { hasText: "Echo Systems is hiring three data entry clerks" }).getByRole("button", { name: "Make it a lead" }).click();
  await page.waitForURL(new RegExp(`/sales/deal/${deal}$`), { timeout: 15000 });
  check("went to the existing deal", page.url().endsWith(`/sales/deal/${deal}`));
  check("no duplicate deal created", (await one("select count(*)::int as n from sales_deals")).n === before);
  check("the post is on the deal's timeline", (await all("select 1 from sales_interactions where deal_id = $1 and summary like 'Radar found them again%'", [deal])).length === 1);

  // 4. deal page "Do not contact": no outreach moves, banner shown
  page.__dialogAnswer = "not a fit";
  await page.getByRole("button", { name: "Do not contact" }).click();
  await page.waitForTimeout(2000);
  await go(`/sales/deal/${deal}`);
  check("deal shows the do-not-contact banner", (await page.getByText(/Do not contact: no outreach moves/).count()) === 1);
  check("Do not contact button gone once blocked", (await page.getByRole("button", { name: "Do not contact" }).count()) === 0);
  const open = await all("select kind from sales_moves where deal_id = $1 and status = 'open'", [deal]);
  check("no open outreach moves for the blocked deal", open.length === 0, open);
  check("blocked by domain echo.io", (await all("select 1 from sales_blocklist where kind = 'domain' and value = 'echo.io' and reason = 'not a fit'")).length === 1);

  // 5. remove entries from the Playbook
  await go("/sales/playbook");
  const rows = page.locator("section#dnc li");
  const n0 = await rows.count();
  await rows.first().getByRole("button", { name: "Remove" }).click();
  await page.waitForTimeout(1500);
  check("remove works", (await one("select count(*)::int as n from sales_blocklist")).n === n0 - 1);
  await db.query("delete from sales_blocklist");
  await t.done();
})().catch((e) => { console.error(e); process.exit(2); });
