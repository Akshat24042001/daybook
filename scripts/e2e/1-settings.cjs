const { setup, check, choose } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, go } = t;
  console.log("Settings: targets, booking link, targeting, after the sale");
  await go("/sales/settings");
  const card = (id) => page.locator(`section#${id}`);

  await card("targets").getByLabel("Monthly revenue target (USD)").fill("20,000");
  await card("targets").getByLabel("New conversations a week").fill("12");
  await card("targets").getByLabel("Outreach messages a day").fill("4");
  await card("targets").getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  let cfg = (await one("select config from sales_settings where id = 1")).config;
  check("targets saved", cfg.targets?.monthly_revenue_usd === 20000 && cfg.targets?.weekly_conversations === 12 && cfg.targets?.daily_outreach === 4, cfg.targets);

  const voice = page.locator("section", { has: page.getByText("You and your voice") });
  await voice.getByLabel("Your booking link").fill("https://cal.com/akshat/30min");
  await voice.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  cfg = (await one("select config from sales_settings where id = 1")).config;
  check("booking link saved", cfg.owner?.booking_url === "https://cal.com/akshat/30min", cfg.owner?.booking_url);
  check("owner name kept when saving voice card", cfg.owner?.name === "Akshat Shah", cfg.owner?.name);
  check("offers no longer saved from settings (catalogue is the source)", !("offers" in cfg) || Array.isArray(cfg.offers), cfg.offers);

  await choose(page, card("targeting").getByLabel("How to choose"), /Even rotation/);
  await card("targeting").getByLabel(/Exploring share/).fill("30");
  await card("targeting").getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  cfg = (await one("select config from sales_settings where id = 1")).config;
  check("targeting set to rotate, explore 30", cfg.radar?.targeting === "rotate" && cfg.radar?.explore_pct === 30, cfg.radar);
  check("other radar settings kept", cfg.radar?.min_score === 60 && cfg.radar?.digest_hour === 9, cfg.radar);
  await choose(page, card("targeting").getByLabel("How to choose"), /Adaptive/);
  await card("targeting").getByLabel(/Exploring share/).fill("20");
  await card("targeting").getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  cfg = (await one("select config from sales_settings where id = 1")).config;
  check("targeting back to adaptive 20", cfg.radar?.targeting === "adaptive" && cfg.radar?.explore_pct === 20, cfg.radar);

  await card("after-sale").getByLabel(/Check in after delivery/).fill("15, 60");
  await card("after-sale").getByLabel(/Suggest more work after/).fill("30");
  await card("after-sale").getByLabel("Offer a monthly retainer at delivery").uncheck();
  await card("after-sale").getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  cfg = (await one("select config from sales_settings where id = 1")).config;
  check("after-sale saved", cfg.post_sale.checkin_days.join() === "15,60" && cfg.post_sale.upsell_after_days === 30 && cfg.post_sale.retainer === false, cfg.post_sale);

  // reload shows saved values
  await go("/sales/settings");
  check("reload shows saved target", (await card("targets").getByLabel("Monthly revenue target (USD)").inputValue()) === "20000");
  check("reload shows saved check-in days", (await card("after-sale").getByLabel(/Check in after delivery/).inputValue()) === "15, 60");
  check("reload shows retainer unchecked", !(await card("after-sale").getByLabel("Offer a monthly retainer at delivery").isChecked()));
  check("offers hint links to Playbook", (await page.locator('a[href="/sales/playbook#offers"]').count()) === 1);

  // restore defaults for the rest of the run
  await card("after-sale").getByLabel(/Check in after delivery/).fill("30, 90");
  await card("after-sale").getByLabel(/Suggest more work after/).fill("45");
  await card("after-sale").getByLabel("Offer a monthly retainer at delivery").check();
  await card("after-sale").getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  cfg = (await one("select config from sales_settings where id = 1")).config;
  check("after-sale restored", cfg.post_sale.checkin_days.join() === "30,90" && cfg.post_sale.upsell_after_days === 45 && cfg.post_sale.retainer === true, cfg.post_sale);
  await t.done();
})().catch((e) => { console.error(e); process.exit(2); });
