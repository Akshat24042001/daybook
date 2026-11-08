const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, all, go, db } = t;
  console.log("Deal page > Send back to Radar");
  // a radar lead turned into a deal by a stray tap, with a message logged that was never sent
  const item = (await one(`insert into sales_radar_items (url_hash, title, url, status, score, fit) values ('e2e-sb-' || extract(epoch from now()), 'E2E: clinic wants a booking bot', 'https://reddit.com/r/x/2', 'qualified', 90, '{"why":"fit"}') returning id`)).id;
  const deal = (await one("insert into sales_deals (title, stage_id, source, radar_item_id) select 'E2E stray tap', id, 'radar', $1 from sales_stages where role = 'contacted' returning id", [item])).id;
  await db.query("update sales_radar_items set deal_id = $2, status = 'converted' where id = $1", [item, deal]);
  await db.query("insert into sales_interactions (deal_id, channel, direction, body, source) values ($1, 'linkedin', 'out', 'Hi there', 'e2e')", [deal]);

  await go(`/sales/deal/${deal}`);
  const btn = page.getByRole("button", { name: "Send back to Radar" });
  check("button shown on a deal made from a radar lead", (await btn.count()) === 1);
  let dialog = "";
  page.once("dialog", (d) => { dialog = d.message(); }); // lib.cjs accepts it
  await btn.click();
  await page.waitForURL(/\/sales\/radar/, { timeout: 15000 }).catch(() => {});
  check("confirm says what goes", /removed, with the 1 message logged on it/.test(dialog), dialog);
  check("lands on Radar", page.url().includes("/sales/radar"), page.url());
  check("deal and its logged message are gone", !(await one("select 1 as x from sales_deals where id = $1", [deal])) && !(await one("select 1 as x from sales_interactions where deal_id = $1", [deal])));
  const it = await one("select status, deal_id, sent_back_at is not null as sb from sales_radar_items where id = $1", [item]);
  check("lead is a new qualified lead again", it.status === "qualified" && it.deal_id === null && it.sb, it);
  await page.getByText("E2E: clinic wants a booking bot").first().waitFor({ timeout: 8000 }).catch(() => {});
  check("lead is listed on Radar", (await page.getByText("E2E: clinic wants a booking bot").count()) > 0);
  const mv = await all("select status from sales_moves where dedupe_key = $1", [`radar:${item}`]);
  check("its 'answer this' move is back", mv.length === 1 && mv[0].status === "open", mv);

  // a deal they replied on is refused, and stays
  const item2 = (await one(`insert into sales_radar_items (url_hash, title, status, score) values ('e2e-sb2-' || extract(epoch from now()), 'E2E: replied lead', 'converted', 90) returning id`)).id;
  const deal2 = (await one("insert into sales_deals (title, stage_id, source, radar_item_id) select 'E2E real talk', id, 'radar', $1 from sales_stages where role = 'engaged' returning id", [item2])).id;
  await db.query("update sales_radar_items set deal_id = $2 where id = $1", [item2, deal2]);
  await db.query("insert into sales_interactions (deal_id, channel, direction, body, source) values ($1, 'email', 'in', 'Yes, interested', 'e2e')", [deal2]);
  await go(`/sales/deal/${deal2}`);
  let asked = false;
  page.once("dialog", () => { asked = true; });
  await page.getByRole("button", { name: "Send back to Radar" }).click();
  const toastMsg = page.locator("[role=status]", { hasText: "real conversation (1 message from them)" });
  await toastMsg.first().waitFor({ timeout: 10000 }).catch(() => {});
  check("refused with the reason, no confirm asked", !asked && (await toastMsg.count()) > 0);
  check("that deal is kept", !!(await one("select 1 as x from sales_deals where id = $1", [deal2])));
  await db.query("delete from sales_deals where id = $1", [deal2]);
  await db.query("delete from sales_radar_items where id = any($1::int[])", [[item, item2]]);

  // a deal that did not come from the radar has no such button
  const plain = (await one("insert into sales_deals (title, stage_id) select 'E2E referral', id from sales_stages where role = 'new' returning id")).id;
  await go(`/sales/deal/${plain}`);
  check("no button on other deals", (await page.getByRole("button", { name: "Send back to Radar" }).count()) === 0);
  await db.query("delete from sales_deals where id = $1", [plain]);
  await t.done();
})();
