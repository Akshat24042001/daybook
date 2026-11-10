const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, all, go, db, ctx } = t;
  console.log("Sending from a move records purpose, draft use and edits; Insights and Today count it");
  await db.query("delete from sales_deals where title = 'E2E send'");
  const person = (await one("insert into sales_people (full_name, phones) values ('Ravi Mehta', '{+971501234567}') returning id")).id;
  const deal = (await one("insert into sales_deals (title, stage_id, person_id) select 'E2E send', id, $1 from sales_stages where role = 'new' returning id", [person])).id;
  await db.query("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,'contact')", [deal, person]);
  const mv = (await one("insert into sales_moves (deal_id, kind, title, channel, draft, ai_draft, due_at, score, dedupe_key) values ($1::int,'first_touch','First message to Ravi Mehta','whatsapp',$2,$2, now() - interval '1 hour', 99, 'first:' || ($1::int)::text) returning id", [deal, "Hi Ravi, saw your post about missed calls."])).id;
  const today0 = (await one("select config from sales_settings")).config;
  await go("/sales");
  const card = page.locator("li", { hasText: "First message to Ravi Mehta" });
  check("move card shown with its draft", (await card.locator("textarea").inputValue()) === "Hi Ravi, saw your post about missed calls.");
  await card.locator("textarea").fill("Hey Ravi, how many calls a day go unanswered at the front desk?");
  // the sandbox has no internet, so record the address the popup was asked to open
  const asked = [];
  ctx.on("request", (r) => { if (/wa\.me|whatsapp/.test(r.url())) asked.push(r.url()); });
  const popup = ctx.waitForEvent("page");
  await card.getByRole("button", { name: "WhatsApp" }).click();
  const wa = await popup;
  await page.waitForTimeout(800);
  const url = decodeURIComponent(asked[0] ?? "").replace(/\+/g, " ");
  check("WhatsApp opened for Ravi's number with the edited text", url.includes("971501234567") && url.includes("how many calls a day go unanswered"), url.slice(0, 160));
  await wa.close();
  // opening the link logs nothing; only confirming does
  check("nothing logged just because WhatsApp opened", !(await one("select 1 as x from sales_interactions where move_id = $1", [mv])));
  await card.getByRole("button", { name: "Yes, sent" }).click();
  await page.waitForTimeout(2000);
  const i = await one("select channel, direction, move_kind, drafted, edited, body from sales_interactions where move_id = $1", [mv]);
  check("send logged with purpose, AI draft used and edited", i && i.channel === "whatsapp" && i.direction === "out" && i.move_kind === "first_touch" && i.drafted === true && i.edited === true, i);
  check("move closed", (await one("select status from sales_moves where id = $1", [mv])).status === "done");
  check("deal moved to Contacted", (await one("select s.role from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1", [deal])).role === "contacted");

  // Today's outreach card counts it
  await go("/today");
  const goal = (today0.targets?.daily_outreach) ?? 5;
  const outToday = (await one(`select count(*)::int as n from sales_interactions i where i.direction = 'out' and i.deal_id is not null
     and i.channel in ('whatsapp','email','linkedin','instagram','sms','twitter','telegram') and (i.occurred_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date`)).n;
  const cardText = await page.locator('a[href="/sales"]', { hasText: "Sales outreach" }).innerText();
  check("Today card shows outreach against the goal", new RegExp(`${outToday} of ${goal}`).test(cardText), { cardText, outToday, goal });

  // the reply arrives: Insights counts the message as answered once it is decided
  await db.query("insert into sales_interactions (deal_id, person_id, channel, direction, occurred_at, body, source) values ($1,$2,'whatsapp','in', now(), 'about 30 a day', 'e2e')", [deal, person]);
  await go("/sales/insights?days=30");
  const msgs = page.locator("section#messages");
  check("Insights 'What gets replies' renders", (await msgs.getByText("By purpose").count()) === 1);
  check("first message purpose listed", (await msgs.getByText("First message").count()) >= 1);
  await t.done();
})().catch((e) => { console.error(e); process.exit(2); });
