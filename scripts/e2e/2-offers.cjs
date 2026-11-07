const { setup, check, choose } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, all, go } = t;
  console.log("Playbook > Offers and quote from a package");
  await go("/sales/playbook");
  const offers = page.locator("section#offers");
  // a clean start: the catalogue as copied from the old list
  await t.db.query("delete from sales_offers; update sales_settings set config = config - 'offers_seeded'");
  await go("/sales/playbook");
  const before = await all("select id, name from sales_offers order by sort, id");
  check("catalogue seeded from the old list (9 offers)", before.length === 9, before.length);

  // add an offer with a package of two lines
  await offers.getByRole("button", { name: "Add an offer" }).click();
  await offers.getByLabel("Offer name", { exact: true }).fill("Voice receptionist");
  await offers.getByLabel(/Also known as/).fill("voice agents, call answering");
  await offers.getByLabel(/One line on what it does/).fill("Answers every call, books appointments, 24/7");
  await offers.getByRole("button", { name: "Package", exact: true }).click();
  await offers.getByLabel("Package name", { exact: true }).fill("Starter");
  check("a new package starts in INR", (await offers.getByLabel("Currency", { exact: true }).innerText()).includes("INR"));
  await choose(page, offers.getByLabel("Currency", { exact: true }), /^AED$/);
  await offers.getByLabel("Timeline", { exact: true }).fill("2 weeks");
  await offers.getByLabel("Item", { exact: true }).first().fill("Setup");
  await offers.getByLabel("Quantity", { exact: true }).first().fill("1");
  await offers.getByLabel("Unit price", { exact: true }).first().fill("3,500");
  await offers.getByRole("button", { name: "Line", exact: true }).click();
  await offers.getByLabel("Item", { exact: true }).nth(1).fill("Monthly minutes");
  await offers.getByLabel("Quantity", { exact: true }).nth(1).fill("3");
  await offers.getByLabel("Unit price", { exact: true }).nth(1).fill("500");
  check("package total shows live (AED 5,000)", (await offers.getByText("AED 5,000").count()) > 0);
  await offers.getByLabel("Scope", { exact: true }).fill("Number, greeting, booking into your calendar");
  await offers.getByRole("button", { name: "Save offer" }).click();
  await page.waitForTimeout(1500);
  const o = await one("select * from sales_offers where name = 'Voice receptionist'");
  check("offer saved", !!o && o.summary === "Answers every call, books appointments, 24/7" && o.keywords.join("|") === "voice agents|call answering", o);
  const p = o?.packages?.[0];
  check("package saved with items, in the picked currency", p && p.currency === "AED" && p.items.length === 2 && p.items[0].unit_price === 3500 && p.items[1].qty === 3 && p.timeline === "2 weeks", p);
  await page.waitForTimeout(800);
  const rowText = await offers.locator("div.rounded-lg", { hasText: "Voice receptionist" }).first().innerText().catch(() => "");
  check("offer row shows its package and total", /Starter AED 5,000/.test(rowText), rowText);

  // config now reads offers from the catalogue
  const lines = await all("select name, summary from sales_offers where active order by sort, id");
  check("catalogue has 10 active offers", lines.length === 10, lines.length);

  // edit: pause an offer, and edit summary of another
  const first = before[0];
  await offers.getByRole("button", { name: `Edit ${first.name}` }).click();
  await offers.getByLabel(/One line on what it does/).fill("Agents that answer, qualify and follow up");
  await offers.getByLabel(/Active/).uncheck();
  await offers.getByRole("button", { name: "Save offer" }).click();
  await page.waitForTimeout(1500);
  const e = await one("select summary, active from sales_offers where id = $1", [first.id]);
  check("edit saved: summary and paused", e.summary === "Agents that answer, qualify and follow up" && e.active === false, e);
  check("paused badge shown", (await offers.getByText("Paused", { exact: true }).count()) === 1);
  // un-pause again
  await offers.getByRole("button", { name: `Edit ${first.name}` }).click();
  await offers.getByLabel(/Active/).check();
  await offers.getByRole("button", { name: "Save offer" }).click();
  await page.waitForTimeout(1500);
  check("re-activated", (await one("select active from sales_offers where id = $1", [first.id])).active === true);

  // delete the last seeded offer
  const last = before[before.length - 1];
  await offers.getByRole("button", { name: `Delete ${last.name}` }).click();
  await page.waitForTimeout(1500);
  check("offer deleted", !(await one("select 1 as x from sales_offers where id = $1", [last.id])));

  // validation: empty name cannot be saved
  await offers.getByRole("button", { name: "Add an offer" }).click();
  check("save disabled without a name", await offers.getByRole("button", { name: "Save offer" }).isDisabled());
  await offers.getByRole("button", { name: "Cancel" }).click();

  // quote from the package on a deal whose services match
  const deal = (await one(`insert into sales_deals (title, stage_id, services, requirements, currency) select 'Clinic phones', id, '{call answering}', 'Front desk misses calls', 'USD' from sales_stages where role = 'engaged' returning id`)).id;
  await go(`/sales/deal/${deal}`);
  await page.getByRole("button", { name: "Quote" }).click();
  const sheet = page.getByRole("dialog");
  check("quote sheet lists the package, marked as a match", (await sheet.getByText("Voice receptionist · Starter").count()) === 1 && (await sheet.getByText(/matches this deal/).count()) === 1);
  check("blank option offered", (await sheet.getByText(/Blank quote/).count()) === 1);
  await sheet.getByText("Voice receptionist · Starter").click();
  await page.waitForURL(/\/sales\/docs\/\d+/, { timeout: 15000 });
  const docId = Number(page.url().match(/docs\/(\d+)/)[1]);
  const rev = await one("select currency, total::float, items, scope, timeline from sales_quote_revisions where doc_id = $1", [docId]);
  check("quote built from package", rev.currency === "AED" && rev.total === 5000 && rev.items.length === 2 && rev.timeline === "2 weeks" && rev.scope.includes("booking into your calendar") && rev.scope.includes("Front desk misses calls"), rev);
  check("quote editor opened", (await page.getByText(/AED/).count()) > 0);

  // a deal with nothing in the catalogue to match still offers packages (not marked) and blank
  await t.done();
})().catch((e) => { console.error(e); process.exit(2); });
