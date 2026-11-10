const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, go, db } = t;
  console.log("Screenshots kept on the deal: gallery, timeline thumbnail, image served");
  await db.query("delete from sales_deals where title = 'SH Screens'");
  const st = await one("select id from sales_stages where role = 'discovery'");
  const deal = (await one("insert into sales_deals (title, stage_id, pipeline_id) values ('SH Screens', $1, (select min(id) from sales_pipelines)) returning id", [st.id])).id;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const cap = (await one("insert into sales_captures (source, text, images, hints, status, deal_id, result) values ('web', '', $1, '{}', 'done', $2, $3) returning id",
    [JSON.stringify([png]), deal, JSON.stringify({ deal_id: deal, summary: "Mail from Neha about bookings" })])).id;
  await db.query("insert into sales_interactions (deal_id, channel, direction, occurred_at, summary, source, capture_id, external_id) values ($1,'email','in',now(),'Mail from Neha about bookings','web',$2,$3)", [deal, cap, `cap:${cap}`]);
  await go(`/sales/deal/${deal}`);
  const gallery = page.getByRole("list", { name: "Screenshots you shared" });
  check("deal shows a Screenshots section", await gallery.isVisible());
  check("gallery has the screenshot", (await gallery.locator("img").count()) === 1);
  const thumbs = page.getByLabel("Screenshots", { exact: true });
  check("timeline entry shows its screenshot", (await thumbs.locator("img").count()) === 1);
  const loaded = await gallery.locator("img").first().evaluate((img) => img.complete && img.naturalWidth > 0);
  check("the image loads", loaded);
  const res = await t.ctx.request.get(`http://localhost:3100/api/sales/shot/${cap}/0`);
  check("image served to you", res.status() === 200 && res.headers()["content-type"] === "image/png");
  const anon = await (await require("playwright").chromium.launch()).newContext();
  const r2 = await anon.request.get(`http://localhost:3100/api/sales/shot/${cap}/0`, { maxRedirects: 0 });
  check("not served without login", r2.status() !== 200 || !(r2.headers()["content-type"] ?? "").startsWith("image/"), r2.status());
  await anon.close();
  await db.query("delete from sales_deals where id = $1", [deal]);
  await t.done();
})();
