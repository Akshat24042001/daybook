const { setup, check, choose } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, go, db } = t;
  console.log("Your own order on the board, priority colours, error screens");
  const st = await one("select id, name from sales_stages where role = 'discovery'");
  await db.query("delete from sales_deals where title like 'OR %'");
  // keep only our three in this column so the drag is unambiguous
  await db.query("update sales_deals set stage_id = (select id from sales_stages where role = 'contacted') where stage_id = $1", [st.id]);
  for (const [title, value] of [["OR Alpha", 900000], ["OR Bravo", 300000], ["OR Charlie", 1000]]) {
    await db.query("insert into sales_deals (title, stage_id, value_amount, currency, value_usd, priority, pipeline_id) values ($1,$2,$3,'INR',$3*0.012,$3/30000,(select min(id) from sales_pipelines))", [title, st.id, value]);
  }
  await go("/sales/pipeline");
  // a fresh context can remember List view or another sort: make sure we are on the board with priority sort
  const board = page.getByRole("button", { name: "Board", exact: true });
  if (await board.count()) await board.click();
  await choose(page, page.getByLabel("Sort cards"), "Sort: Priority + your order");
  const col = page.locator("section").filter({ has: page.getByRole("heading", { name: new RegExp(`^${st.name}`) }) }).first();
  const titles = async () => (await col.locator("li p.text-sm.font-semibold").allInnerTexts()).filter((x) => x.startsWith("OR "));
  const before = await titles();
  check("three cards in the column", before.length === 3, before);
  check("priority legend explains the colours", await page.getByText("moved 5+ points since yesterday").isVisible());

  // drag the last card onto the first: it goes above it (column centred, away from the auto-scroll edges)
  await col.evaluate((el) => { const sc = el.parentElement; sc.scrollLeft = el.offsetLeft - sc.clientWidth / 2 + el.clientWidth / 2; window.scrollTo(0, 0); });
  await page.waitForTimeout(200);
  const last = before[2], first = before[0];
  const grip = col.getByRole("button", { name: `Drag ${last} to reorder or to another stage` });
  const target = col.locator("li").filter({ hasText: first }).first();
  const g = await grip.boundingBox(); const tb = await target.boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 5, g.y - 20, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 12, { steps: 15 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const after = await titles();
  check("dragged card now on top", after[0] === last, after);
  const ranks = await db.query("select title, manual_rank from sales_deals where title like 'OR %' order by manual_rank nulls last");
  check("order saved: dragged card pinned first", ranks.rows[0].title === last && ranks.rows[0].manual_rank === 1, ranks.rows);
  check("cards below the drop point stay automatic", ranks.rows[1].manual_rank === null && ranks.rows[2].manual_rank === null, ranks.rows);

  // drag the top card down onto the second: it lands below it, and both are pinned in that order
  {
    const now = await titles();
    const g2 = await col.getByRole("button", { name: `Drag ${now[0]} to reorder or to another stage` }).boundingBox();
    const t2 = await col.locator("li").filter({ hasText: now[1] }).first().boundingBox();
    await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
    await page.mouse.down();
    await page.mouse.move(g2.x + 5, g2.y + 20, { steps: 5 });
    await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height - 12, { steps: 15 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const r2 = await db.query("select title, manual_rank from sales_deals where title like 'OR %' order by manual_rank nulls last");
    check("dragging down puts it below and pins both", r2.rows[0].title === now[1] && r2.rows[1].title === now[0] && r2.rows[1].manual_rank === 2, r2.rows);
  }

  await go("/sales/pipeline");
  check("order survives a reload", (await titles())[1] === last, await titles());
  check("hand-placed card shows a pin", (await col.locator('[aria-label="Placed by you"]').count()) >= 1);

  // reset
  await col.getByRole("button", { name: "Reset order" }).click();
  await page.waitForTimeout(1500);
  const n = await one("select count(*)::int as n from sales_deals where title like 'OR %' and manual_rank is not null");
  check("reset clears your order", n.n === 0, n);

  // the priority chip uses the band colours
  const chip = col.locator("span[title^='Priority']").first();
  const cls = await chip.getAttribute("class");
  check("priority chip carries a band colour", /bg-(good|p-mint|p-butter|muted)/.test(cls ?? ""), cls);

  // a page that throws shows the friendly screen, not a bare "Application error"
  const errs = t.errors.length;
  await page.goto("http://localhost:3100/sales/deal/999999999", { waitUntil: "networkidle" });
  t.errors.splice(errs); // the 404 itself is logged by the browser; that is expected
  check("missing deal gives a normal page, not an application error", !(await page.getByText("Application error").count()));

  await db.query("delete from sales_deals where title like 'OR %'");
  await t.done();
})();
