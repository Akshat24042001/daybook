const { setup, check } = require("./lib.cjs");
// amounts are summed in USD (value_usd) and shown in the report currency (INR by default)
let rate = 0.012;
const usd = (n) => `₹${Math.round(n / rate).toLocaleString("en-IN")}`;
const inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;
(async () => {
  const t = await setup();
  const { page, one, all, go } = t;
  console.log("Insights, Stats and Radar Plan numbers against independent SQL");
  const tz = "Asia/Kolkata";
  const cfg = (await one("select config from sales_settings")).config;
  rate = cfg.fx?.[cfg.report_currency ?? "INR"] ?? 0.012;
  const target = cfg.targets?.monthly_revenue ?? 0;

  // ---- target card
  const won = await one(`
    select coalesce(sum(d.value_usd),0)::float as v, count(*)::int as n from sales_deals d join sales_stages s on s.id = d.stage_id
    where s.category = 'won' and (coalesce((select min(e.created_at) from sales_deal_events e join sales_stages st on st.id = e.to_stage where e.deal_id = d.id and st.category = 'won'), d.closed_at, d.updated_at) at time zone $1)::date
          between date_trunc('month', now() at time zone $1)::date and (date_trunc('month', now() at time zone $1) + interval '1 month - 1 day')::date`, [tz]);
  const likely = await one(`
    select coalesce(sum(d.value_usd * coalesce(d.probability, s.probability) / 100.0),0)::float as v from sales_deals d join sales_stages s on s.id = d.stage_id
    where s.category = 'open' and d.value_usd is not null and (s.role in ('proposal','negotiation') or d.expected_close <= (date_trunc('month', now() at time zone $1) + interval '1 month - 1 day')::date)`, [tz]);
  for (const days of [30, 90, 180]) {
    await go(`/sales/insights?days=${days}`);
    check(`insights ${days} days renders, period tab selected`, (await page.getByRole("tab", { name: `${days} days`, selected: true }).count()) === 1);
  }
  await go("/sales/insights?days=90");
  const tc = await page.locator("section#target").innerText();
  check("target card: won this month matches SQL", tc.includes(usd(won.v)), { want: usd(won.v) });
  check("target card: target shown", tc.includes(`target ${inr(target)}`), target);
  check("target card: projected = won + likely (weighted)", tc.includes(usd(won.v + likely.v)), { want: usd(won.v + likely.v) });
  check("target card: 'What it takes' table present", /Close the gap this month[\s\S]*Every week, steady/.test(tc));
  const bad = await page.locator("body").innerText();
  check("no NaN, undefined or Infinity anywhere on Insights", !/NaN|undefined|Infinity/.test(bad));

  // ---- funnel: leads created in the last 90 days
  const created = (await one("select count(*)::int as n from sales_deals where created_at > now() - interval '90 days'")).n;
  const fun = await page.locator("section#funnel li").first().innerText();
  check("funnel first step = deals created in 90 days", fun.includes(String(created)), { fun, created });
  const steps = await page.locator("section#funnel li").allInnerTexts();
  const nums = steps.map((s) => Number((s.match(/(\d+)/) ?? [0, 0])[1]));
  check("funnel never increases step to step", nums.every((n, i) => i === 0 || n <= nums[i - 1]), nums);

  // ---- segments: by service deal counts
  const svc = await all(`select s as k, count(*)::int as n from (
    select d.id, unnest(case when cardinality(d.services) = 0 then array['Service not set'] else d.services end) as s from sales_deals d where d.created_at > now() - interval '90 days') x group by 1`);
  const rows = await page.locator("section#segments table").first().locator("tbody tr").allInnerTexts();
  for (const r of svc) {
    const row = rows.find((x) => x.split("\t")[0].trim() === r.k);
    check(`segment row "${r.k}" shows ${r.n} deals`, !!row && row.split("\t")[1].trim() === String(r.n), row);
  }

  // ---- messages and speed render with sane numbers
  const mt = await page.locator("section#messages").innerText();
  const m = mt.match(/Messages sent\s+(\d+)\s+Got a reply\s+(\d+)/);
  check("messages: replies never exceed sends", !!m && Number(m[2]) <= Number(m[1]), m && m.slice(1));
  const st = await page.locator("section#speed").innerText();
  check("speed section renders both halves", st.includes("Time to first message") && st.includes("Your reply time"));

  // ---- Stats: Won tile = sum of values that reached Won in the last 30 days
  await go("/stats");
  const wonRange = await one(`select coalesce(sum(w.value_usd),0)::float as v from (
     select d.value_usd, (select min(e.created_at) from sales_deal_events e join sales_stages s on s.id = e.to_stage where e.deal_id = d.id and s.category = 'won') as at from sales_deals d) w
     where w.at is not null and (w.at at time zone $1)::date between ((now() at time zone $1)::date - 29) and (now() at time zone $1)::date`, [tz]);
  const statsText = await page.locator("body").innerText();
  check("Stats has the Sales section", /\nSALES\n|\nSales\n/i.test(statsText));
  check("Stats Won tile matches SQL", statsText.includes(usd(wonRange.v)), usd(wonRange.v));

  // ---- Radar plan: why lines and the results table
  await go("/sales/radar");
  await page.getByRole("button", { name: /^Plan/ }).first().click();
  await page.waitForTimeout(600);
  const plan = await page.locator("body").innerText();
  check("plan explains why this country and this industry", (plan.match(/Why [^:\n]+: /g) ?? []).length >= 2);
  const countries = (cfg.countries ?? []).length || 10;
  const table = await page.locator("table").first().locator("tbody tr").count();
  check("results table lists every country on the list", table === countries, { table, countries });
  const focus = await all("select kind, value, mode from sales_focus order by created_at desc limit 2");
  check("this period's choice is stored with its mode", focus.length === 2 && focus.every((f) => ["exploit", "explore", "fixed"].includes(f.mode)), focus);
  await t.done();
})().catch((e) => { console.error(e); process.exit(2); });
