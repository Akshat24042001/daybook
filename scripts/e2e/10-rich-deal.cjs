const { setup, check, choose } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, all, go, db } = t;
  console.log("Deal page: every field, history, activity log, closing checklists; pipeline columns and filters; your own fields");
  const st = async (role) => (await one("select id from sales_stages where role = $1", [role])).id;
  await db.query("delete from sales_custom_fields");
  await db.query("delete from sales_deals where title = 'E2E rich deal'");
  const deal = (await one("insert into sales_deals (title, stage_id, value_amount, currency, value_usd) values ('E2E rich deal', $1, 200000, 'INR', 2400) returning id", [await st("negotiation")])).id;
  const person = (await one("insert into sales_people (full_name) values ('E2E Meera Iyer') returning id")).id;
  await db.query("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,'contact')", [deal, person]);
  await db.query("update sales_deals set person_id = $2 where id = $1", [deal, person]);

  // ---- your own field, needed to win
  await go("/sales/settings#fields");
  const fields = page.locator("section#fields");
  await fields.getByRole("button", { name: "Add a field" }).click();
  await fields.getByLabel("Field name").fill("Signed by");
  await fields.getByLabel("Needed to close a deal as won").check();
  await fields.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1500);
  const cf = await one("select key, required_to_win from sales_custom_fields where label = 'Signed by'");
  check("custom field saved with a key and 'needed to win'", cf && cf.key === "signed_by" && cf.required_to_win, cf);
  check("reasons card lists the lost reasons", (await page.locator("section#reasons").getByLabel("Lost reasons").inputValue()).includes("Chose a competitor"));

  // ---- details and the edit sheet
  await go(`/sales/deal/${deal}`);
  const details = page.getByLabel("Deal details");
  check("qualification meter shows 0 of 12", (await details.innerText()).includes("Qualification 0/12"));
  await details.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("tab", { name: "Location" }).click();
  await page.getByLabel("City", { exact: true }).fill("Pune");
  await page.getByLabel("State / region", { exact: true }).fill("Maharashtra");
  await page.getByRole("tab", { name: "The need" }).click();
  await page.getByLabel("Problem today").fill("Front desk misses 30 calls a day");
  await page.getByLabel("Budget", { exact: true }).fill("2 to 3 lakh");
  await page.getByRole("tab", { name: "How they decide" }).click();
  await choose(page, page.getByRole("dialog").getByLabel("Who signs", { exact: true }), /E2E Meera Iyer/);
  await page.getByLabel("Competitors").fill("Zoho, in-house");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(1800);
  const d1 = await one("select city, region, pain, budget, economic_buyer_id, competitors from sales_deals where id = $1", [deal]);
  check("edit sheet saved fields across tabs", d1.city === "Pune" && d1.region === "Maharashtra" && d1.pain.startsWith("Front desk") && d1.budget === "2 to 3 lakh" && d1.economic_buyer_id === person && d1.competitors.join() === "Zoho,in-house", d1);
  const fe = await all("select field, new_value, cause from sales_deal_events where deal_id = $1 and kind = 'field' order by id", [deal]);
  check("each change written to history", ["city", "region", "pain", "budget", "economic_buyer_id", "competitors"].every((f) => fe.some((e) => e.field === f)) && fe.find((e) => e.field === "economic_buyer_id").new_value === "E2E Meera Iyer", fe);
  check("details show the new values and qualification moved", /Pune/.test(await details.innerText()) && /Qualification [45]\/12/.test(await details.innerText()));

  // ---- the activity log, back-dated, then corrected
  await page.getByRole("button", { name: "Log an activity or remark" }).click();
  const log = page.getByLabel("Log an activity");
  await choose(page, log.getByLabel("Activity type"), /Phone call/);
  const when = new Date(Date.now() - 2 * 86400000);
  const p2 = (n) => String(n).padStart(2, "0");
  await log.getByLabel("When").fill(`${when.getFullYear()}-${p2(when.getMonth() + 1)}-${p2(when.getDate())}T11:30`);
  await log.getByLabel("Duration").fill("25");
  await choose(page, log.getByLabel("Outcome"), /^Connected$/);
  await log.getByLabel("About").fill("Pricing call with the owner");
  await log.getByLabel("What was discussed").fill("Wants WhatsApp booking\nAsked for 2 phases");
  await log.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1800);
  const act = await one("select channel, duration_min, outcome, subject, occurred_at from sales_interactions where deal_id = $1 and source = 'manual' order by id desc limit 1", [deal]);
  check("activity logged with type, duration, outcome", act && act.channel === "call" && act.duration_min === 25 && act.outcome === "Connected" && act.subject === "Pricing call with the owner", act);
  check("logged at the chosen time (2 days ago, 11:30 local)", act && Math.abs(new Date(act.occurred_at) - new Date(`${when.getFullYear()}-${p2(when.getMonth() + 1)}-${p2(when.getDate())}T11:30`)) < 60000, act && act.occurred_at);
  // the full timeline (the summary card at the top has a short one without edit buttons)
  const tl = page.locator("li", { hasText: "Pricing call with the owner" }).filter({ has: page.getByRole("button", { name: "Edit entry" }) }).first();
  check("timeline shows date, duration and outcome", /25 min/.test(await tl.innerText()) && /Connected/.test(await tl.innerText()));
  await tl.getByRole("button", { name: "Edit entry" }).click();
  await page.getByLabel("Summary").fill("Pricing call with the owner (both partners)");
  await page.getByRole("button", { name: "Save" }).last().click();
  await page.waitForTimeout(1500);
  check("entry corrected and marked edited", (await one("select summary, edited_at is not null as e from sales_interactions where deal_id = $1 and source = 'manual' order by id desc limit 1", [deal])).e === true);

  // ---- lost, with a reason; then reopened with a reason
  await go(`/sales/deal/${deal}`);
  await page.getByRole("button", { name: /^Lost/ }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await page.waitForTimeout(800);
  check("lost without a reason is refused", (await one("select s.role from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1", [deal])).role === "negotiation");
  await choose(page, page.getByLabel("Reason"), /Chose a competitor/);
  await page.getByLabel("Lost to").fill("Acme Digital");
  await page.getByLabel("What happened").fill("They were 40k cheaper");
  await page.getByLabel("Lesson").fill("Lead with the clinic case study");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await page.waitForTimeout(1800);
  const lost = await one("select s.role, d.lost_reason, d.lost_to, d.lost_detail, d.lessons from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1", [deal]);
  check("lost with reason, competitor, detail, lesson", lost.role === "lost" && lost.lost_reason === "Chose a competitor" && lost.lost_to === "Acme Digital" && lost.lessons.startsWith("Lead"), lost);
  check("closing record shows why it was lost", /Why it was lost[\s\S]*Chose a competitor[\s\S]*Acme Digital/.test(await page.getByLabel("Closing record", { exact: true }).innerText()));
  const reopenTo = (await all("select s.name from sales_transitions t join sales_stages s on s.id = t.to_stage where t.from_stage = $1 and s.category = 'open' order by s.sort", [await st("lost")]))[0];
  if (reopenTo) {
    await page.getByRole("button", { name: new RegExp(`^${reopenTo.name}`) }).click();
    await choose(page, page.getByLabel("Reason"), /They came back/);
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await page.waitForTimeout(1800);
    check("reopened with a reason", (await one("select s.category from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1", [deal])).category === "open");
  } else {
    check("lost can be reopened (an edge exists)", false, "no open stage after Lost in the flow");
  }
  await db.query("update sales_deals set stage_id = $2 where id = $1", [deal, await st("negotiation")]);

  // ---- won: the checklist
  await go(`/sales/deal/${deal}`);
  await page.getByRole("button", { name: /^Won, advance pending/ }).click();
  const sheet = page.getByRole("dialog");
  check("won checklist opens with POC, amount, delivery, scope, reason and your field", /Point of contact[\s\S]*Final amount[\s\S]*Delivery date[\s\S]*Scope of work[\s\S]*Why they chose you[\s\S]*Signed by/.test(await sheet.innerText()));
  await sheet.getByLabel("Final amount").fill("2,40,000");
  await sheet.getByLabel("Delivery time").fill("6 weeks");
  await sheet.getByLabel("Scope of work").fill("WhatsApp booking bot, 3 flows. Not included: payments.");
  await sheet.getByLabel("Advance %").fill("50");
  await choose(page, sheet.getByLabel("Why they chose you"), /Proof: case study/);
  await sheet.getByRole("button", { name: "Close as won" }).click();
  await page.waitForTimeout(1000);
  check("won refused without your required field", (await one("select s.category from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1", [deal])).category === "open");
  await sheet.getByLabel("Signed by").fill("Director");
  await sheet.getByRole("button", { name: "Close as won" }).click();
  await page.waitForTimeout(2000);
  const w = await one("select s.category, d.poc_id, d.value_amount::float as v, d.delivery_duration, d.scope, d.won_reason, d.custom from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1", [deal]);
  check("won with the full record", w.category === "won" && w.poc_id === person && w.v === 240000 && w.delivery_duration === "6 weeks" && w.won_reason.startsWith("Proof") && w.custom.signed_by === "Director", w);
  const pays = await all("select label, amount::float as a from sales_payments where deal_id = $1 order by id", [deal]);
  check("advance and balance planned", pays.length === 2 && pays[0].a === 120000 && pays[1].a === 120000, pays);
  const rec = await page.getByLabel("Closing record", { exact: true }).innerText();
  check("closing record shows contact, amount and scope", /E2E Meera Iyer/.test(rec) && /₹2,40,000/.test(rec) && /WhatsApp booking bot/.test(rec));

  // ---- the journey
  const j = page.getByLabel("Journey");
  const jt = await j.innerText();
  check("journey lists the moves with reasons and time in stage", /Negotiation → Lost/.test(jt) && /Chose a competitor/.test(jt) && /after .* in Negotiation/.test(jt));
  check("journey shows per-stage totals", /Won, advance pending: .*so far/.test(jt));
  await j.getByRole("button", { name: /Show field changes/ }).click();
  check("field changes can be shown", /City:/.test(await j.innerText()) && /₹2,00,000/.test(await j.innerText()));

  // ---- pipeline: list columns and filters
  await go("/sales/pipeline");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: /^won$/ }).click();
  await page.getByRole("button", { name: /^Columns/ }).click();
  await page.getByRole("dialog").getByLabel("City").check();
  await page.getByRole("dialog").getByLabel("Signed by").check();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  const row = page.locator("tr", { hasText: "E2E rich deal" });
  check("list shows chosen columns, including your own field", /Pune/.test(await row.innerText()) && /Director/.test(await row.innerText()));
  await page.getByRole("button", { name: /^Filters/ }).click();
  await choose(page, page.getByRole("dialog").getByLabel("City"), /^Pune$/);
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  check("city filter keeps only Pune deals", (await page.locator("tbody tr").count()) >= 1 && (await page.locator("tbody tr", { hasNotText: "Pune" }).count()) === 0);

  await db.query("delete from sales_deals where id = $1", [deal]);
  await db.query("delete from sales_people where id = $1", [person]);
  await db.query("delete from sales_custom_fields");
  await t.done();
})();
