// Search finds things by any word, in any field: a deal by a word only in its chat, a radar lead by a word only in
// its research, a hidden-need lead by its kind, and the same through Ctrl K.
const { setup, check } = require("./lib.cjs");

(async () => {
  const { page, one, go, done } = await setup();
  const tag = Date.now().toString(36);
  const deal = await one(`insert into sales_deals (title, stage_id) values ($1, (select id from sales_stages where key = 'new')) returning id`, [`Search deal ${tag}`]);
  await one(`insert into sales_interactions (deal_id, channel, direction, body) values ($1, 'whatsapp', 'in', $2) returning id`, [deal.id, `Can it read our zq${tag} invoices?`]);
  const lead = await one(`insert into sales_radar_items (url, url_hash, title, body, status, score, lead_kind, identity) values ($1, md5($1), $2, 'We found a public signal', 'qualified', 72, 'signal', $3) returning id`,
    [`https://e2e.example/${tag}`, `Gulf Gems ${tag}, Dubai: hiring salespeople`, JSON.stringify({ status: "found", person: `Farah Qx${tag}`, emails: [`farah${tag}@gulfgems.ae`], phones: [] })]);

  await go("/sales/pipeline");
  await page.getByLabel("Search deals").fill(`zq${tag}`);
  await page.getByText(`Search deal ${tag}`).first().waitFor({ timeout: 10000 });
  check("pipeline finds a deal by a word only in its chat", true);

  await go("/sales/radar");
  await page.getByLabel("Search the radar").fill(`qx${tag}`);
  await page.getByText(`Gulf Gems ${tag}, Dubai`).first().waitFor({ timeout: 10000 });
  check("radar finds a lead by a word only in its research", true);
  await page.getByLabel("Search the radar").fill("");
  await page.getByRole("button", { name: "Hidden needs" }).click();
  await page.getByText(`Gulf Gems ${tag}, Dubai`).first().waitFor({ timeout: 10000 });
  check("the Hidden needs filter shows it", await page.getByText("hidden need").first().isVisible());

  await go("/today");
  await page.keyboard.press("Control+k");
  await page.keyboard.type(`zq${tag}`);
  await page.getByText(`Search deal ${tag}`).first().waitFor({ timeout: 10000 });
  check("Ctrl K finds the deal too", true);
  await page.keyboard.press("Escape");
  await one("delete from sales_radar_items where id = $1 returning id", [lead.id]);
  await done();
})();
