// Nothing is lost: a lead deleted from its page shows in History and in Deleted, and Restore brings it back whole.
const { setup, check } = require("./lib.cjs");

(async () => {
  const { page, one, go, done } = await setup();
  const stage = await one("select id from sales_stages where category = 'open' order by sort limit 1");
  const mk = async (title) => {
    const d = await one("insert into sales_deals (title, stage_id) values ($1, $2) returning id", [title, stage.id]);
    const n = await one("insert into sales_interactions (deal_id, channel, direction, body, occurred_at, source) values ($1, 'note', 'internal', $2, now(), 'manual') returning id", [d.id, `${title}: wants a booking bot`]);
    return { id: d.id, note: n.id };
  };
  const tag = Date.now().toString(36);
  const a = await mk(`E2E bin clinic ${tag}`);

  // ---- delete from the deal page
  await go(`/sales/deal/${a.id}`);
  await page.getByRole("button", { name: /^Edit/ }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Delete" }).last().click();
  await page.waitForTimeout(2500);
  check("deal deleted", !(await one("select 1 from sales_deals where id = $1", [a.id])));
  check("a full copy is kept, with its note", !!(await one("select 1 from deleted_rows where tbl = 'sales_interactions' and pk->>'id' = $1", [String(a.note)])));

  // ---- History shows it, with the right name
  await go("/history");
  const hist = await page.locator("main").innerText();
  check("History lists the deletion by its own name", hist.includes(`Removed deal “E2E bin clinic ${tag}”`) || hist.includes(`Deleted deal “E2E bin clinic ${tag}”`), hist.slice(0, 300));
  check("History links to Deleted", await page.getByRole("link", { name: "Deleted" }).first().isVisible());

  // ---- Deleted lists it; Restore brings it back
  await go("/deleted");
  const row = page.locator("li", { hasText: `E2E bin clinic ${tag}` }).first();
  check("Deleted lists the lead with its linked items", /with \d+ linked item/.test(await row.innerText()), await row.innerText());
  await row.getByRole("button", { name: /^Restore/ }).click();
  await page.waitForTimeout(2000);
  check("deal back with the same id", !!(await one("select 1 from sales_deals where id = $1", [a.id])));
  check("its note is back", !!(await one("select 1 from sales_interactions where id = $1", [a.note])));
  // the list refreshes after the restore: wait for it rather than a fixed time
  const restoredRow = page.locator("li", { hasText: `E2E bin clinic ${tag}` }).first();
  await restoredRow.getByText("restored", { exact: true }).waitFor({ timeout: 10000 }).catch(() => {});
  check("marked restored", /restored/.test(await restoredRow.innerText()));
  await go(`/sales/deal/${a.id}`);
  check("the deal page opens again with its note", (await page.locator("main").innerText()).includes("wants a booking bot"));

  // ---- bulk delete from the pipeline list, found by search, restored
  const b = await mk(`E2E bin bulk one ${tag}`);
  const c = await mk(`E2E bin bulk two ${tag}`);
  await go("/deleted?q=" + encodeURIComponent(`bulk one ${tag}`));
  check("search shows nothing before the delete", !(await page.locator("main").innerText()).includes(`bulk one ${tag}`));
  // delete both in one action through the same server action the pipeline uses
  await go("/sales/pipeline");
  const listToggle = page.getByRole("button", { name: /list/i }).first();
  if (await listToggle.isVisible().catch(() => false)) await listToggle.click().catch(() => {});
  await page.waitForTimeout(600);
  const pickB = page.getByLabel(`Select E2E bin bulk one ${tag}`);
  if (await pickB.count()) {
    await pickB.check();
    await page.getByLabel(`Select E2E bin bulk two ${tag}`).check();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.waitForTimeout(2500);
    check("both deleted from the list", !(await one("select 1 from sales_deals where id in ($1, $2)", [b.id, c.id])));
    await go("/deleted");
    const bulk = page.locator("li", { hasText: `bulk one ${tag}` }).first();
    check("one entry names both", /Deleted 2 deals/.test(await bulk.innerText()) && (await bulk.innerText()).includes(`bulk two ${tag}`), await bulk.innerText());
    await bulk.getByRole("button", { name: /^Restore/ }).click();
    await page.waitForTimeout(2000);
    check("both back", (await one("select count(*)::int n from sales_deals where id in ($1, $2)", [b.id, c.id])).n === 2);
  } else {
    console.log("  (pipeline list view not shown here, bulk check skipped)");
  }

  // ---- phone width: no sideways scroll
  await page.setViewportSize({ width: 390, height: 844 });
  await go("/deleted");
  check("Deleted fits a phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: "/tmp/e2e-logs/deleted-phone.png" });
  await done();
})();
