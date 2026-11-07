const { setup, check, U } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, all, go, db, ctx } = t;
  console.log("The background tick: objections, proofs, focus, after-sale moves, labels on the Moves page");
  await db.query("delete from sales_deals where title like 'E2E after %'");
  await db.query("delete from sales_jobs where kind in ('sync_objections','draft_proof')");
  await db.query("delete from sales_focus");
  await db.query("delete from sales_deal_objections; delete from sales_objections; delete from sales_proofs");
  // objections waiting to be grouped
  const any = (await one("select id from sales_deals order by id limit 1")).id;
  await db.query("update sales_deals set objections = '{\"we already have an agency\"}' where id = $1", [any]);
  // a deal delivered 31 days ago (check-in at 30 days due) and one delivered 2 days ago (retainer offer)
  const st = async (role) => (await one("select id from sales_stages where role = $1", [role])).id;
  const mk = async (title, daysAgo) => {
    const id = (await one("insert into sales_deals (title, stage_id, services, value_usd, value_amount, currency) values ($1,$2,'{Websites}',4000,4000,'USD') returning id", [title, await st("delivered")])).id;
    await db.query("insert into sales_deal_events (deal_id, kind, to_stage, created_at) values ($1,'stage',$2, now() - ($3 || ' days')::interval)", [id, await st("delivered"), String(daysAgo)]);
    await db.query("update sales_deals set stage_changed_at = now() - ($2 || ' days')::interval where id = $1", [id, String(daysAgo)]);
    return id;
  };
  const d31 = await mk("E2E after 31", 31);
  const d2 = await mk("E2E after 2", 2);

  const r = await ctx.request.post(U + "/api/cron/tick", { headers: { authorization: "Bearer testcron" } });
  check("tick answers ok", r.ok(), r.status());
  // the sales work runs after the response; give it time
  let done = false;
  for (let i = 0; i < 30 && !done; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const j = await all("select kind, status from sales_jobs where kind in ('sync_objections','draft_proof')");
    done = j.length > 0 && j.every((x) => x.status === "done" || x.status === "failed");
  }
  // a second tick runs the jobs the first one queued
  await ctx.request.post(U + "/api/cron/tick", { headers: { authorization: "Bearer testcron" } });
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const j = await all("select kind, status from sales_jobs where kind in ('sync_objections','draft_proof')");
    if (j.length && j.every((x) => x.status === "done" || x.status === "failed")) break;
  }
  const jobs = await all("select kind, status, last_error from sales_jobs where kind in ('sync_objections','draft_proof') order by kind");
  check("objection and proof jobs ran without failing", jobs.length >= 2 && jobs.every((j) => j.status === "done"), jobs);
  check("objection grouped by the daily job", (await all("select 1 from sales_objections where label = 'We already have an agency'")).length === 1);
  check("case study drafted for a delivered deal", (await one("select count(*)::int as n from sales_proofs where deal_id in ($1,$2)", [d31, d2])).n >= 1);
  // the period's focus is decided at its first use (a radar sweep, the digest, the Radar page) and then kept
  await go("/sales/radar");
  const focus = await all("select kind, mode from sales_focus order by kind");
  check("this week's country and today's industry chosen and stored", focus.length === 2 && focus[0].kind === "country" && focus[1].kind === "industry", focus);
  // more ticks within the day must not re-run the daily objection job
  for (let i = 0; i < 2; i++) { await ctx.request.post(U + "/api/cron/tick", { headers: { authorization: "Bearer testcron" } }); await new Promise((res) => setTimeout(res, 6000)); }
  check("daily objection job runs once, not every minute", (await one("select count(*)::int as n from sales_jobs where kind = 'sync_objections'")).n === 1);
  await go("/sales"); // moves are rebuilt every 10 minutes by the tick, or at once when you open Moves
  const m31 = await all("select kind, title from sales_moves where deal_id = $1 and status = 'open'", [d31]);
  const m2 = await all("select kind, title from sales_moves where deal_id = $1 and status = 'open'", [d2]);
  check("30-day check-in created for the deal delivered 31 days ago", m31.some((m) => m.kind === "checkin" && m.title.includes("30 days after delivery")), m31);
  check("no retainer offer once 30 days have passed", !m31.some((m) => m.kind === "retainer"), m31);
  check("retainer offer for the deal delivered 2 days ago", m2.some((m) => m.kind === "retainer"), m2);
  check("no check-in yet for the deal delivered 2 days ago", !m2.some((m) => m.kind === "checkin"), m2);

  const body = await page.locator("main").innerText();
  check("Moves page labels the check-in", body.includes("Client check-in"));
  check("Moves page labels the retainer offer", body.includes("Retainer"));
  await t.done();
})().catch((e) => { console.error(e); process.exit(2); });
