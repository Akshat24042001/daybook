const fs = require("fs");
const path = require("path");
const os = require("os");
const { setup, check, choose } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, ctx, one, all, go, db } = t;
  console.log("Fit and service hints, line items, recurring and renewals, pipelines, playbooks, reports, bulk and CSV, team");
  const st = async (role) => (await one("select id from sales_stages where role = $1", [role])).id;
  await db.query("delete from sales_deals where title like 'R2 %'");
  await db.query("delete from sales_team where name like 'R2 %'");
  await db.query("delete from sales_pipelines where name like 'R2 %'");
  const co = (await one("insert into sales_companies (name, industry, employees, country) values ('R2 Shah Dental','Dental clinics',30,'India') returning id")).id;
  const p = (await one("insert into sales_people (full_name, company_id, is_decision_maker) values ('R2 Dr Shah',$1,true) returning id", [co])).id;
  const deal = (await one("insert into sales_deals (title, stage_id, company_id, person_id, source, requirements, country, industry, pipeline_id) values ('R2 Shah Dental', $1, $2, $3, 'referral', 'Front desk misses about 30 calls a day', 'India', 'Dental clinics', (select min(id) from sales_pipelines)) returning id", [await st("discovery"), co, p])).id;
  await db.query("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,'decision_maker')", [deal, p]);

  // ---- settings: team, pipeline, playbook
  await go("/sales/settings#team");
  const team = page.locator("section#team");
  await team.getByRole("button", { name: "Add a person" }).click();
  await team.getByLabel("Member name").fill("R2 Riya");
  await team.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  const riya = await one("select id from sales_team where name = 'R2 Riya'");
  check("team member added", !!riya);
  const pipes = page.locator("section#pipelines");
  await pipes.getByRole("button", { name: "Add a pipeline" }).click();
  await pipes.getByLabel("Pipeline name").fill("R2 Retainers");
  await pipes.getByText("Won, advance pending", { exact: true }).click();
  await pipes.getByText("Project live", { exact: true }).click();
  await pipes.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  const pipe = await one("select id, stage_ids from sales_pipelines where name = 'R2 Retainers'");
  check("pipeline added with its stages", pipe && pipe.stage_ids.length === 2, pipe);
  const pb = page.locator("section#stage-playbooks");
  check("stage playbook editor shows discovery questions", (await pb.getByLabel("Questions").inputValue()).includes("Walk me through how this works today"));

  // ---- deal page: fit, hints, items, playbook, call script, owner and recurring
  await go(`/sales/deal/${deal}`);
  const fit = page.getByLabel("Fit", { exact: true });
  const ft = await fit.innerText();
  check("fit card shows a grade and reasons", /Fit\s*[AB] · \d+\/100/.test(ft) && /your home market/.test(ft) && /talking to who decides/.test(ft), ft.slice(0, 300));
  check("fit suggests voice agents because of missed calls", /Voice agents/.test(ft) && /calls going unanswered/.test(ft));
  await fit.locator("li", { hasText: "Voice agents", has: page.getByRole("button", { name: "Add" }) }).first().getByRole("button", { name: "Add" }).click();
  await page.waitForTimeout(1500);
  check("hint added to the deal's services", (await one("select services from sales_deals where id = $1", [deal])).services.some((s) => /Voice agents/.test(s)));

  const items = page.getByLabel("Items", { exact: true });
  await items.getByRole("button", { name: "Item" }).click();
  await page.getByLabel("Item name").fill("Voice booking agent");
  await page.getByLabel("Price per unit").fill("2,00,000");
  await page.getByLabel("Discount %").fill("10");
  await page.getByRole("button", { name: "Save" }).last().click();
  await page.waitForTimeout(1500);
  await items.getByRole("button", { name: "Item" }).click();
  await page.getByLabel("Item name").fill("Support and tuning");
  await page.getByLabel("Price per unit").fill("15000");
  await choose(page, page.getByLabel("Billed"), /^Monthly$/);
  await page.getByRole("button", { name: "Save" }).last().click();
  await page.waitForTimeout(1500);
  const it = await all("select name, qty::float, unit_price::float, discount_pct::float, tax_pct::float, billing from sales_deal_items where deal_id = $1 order by id", [deal]);
  check("two items saved, GST 18% by default", it.length === 2 && it[0].unit_price === 200000 && it[0].discount_pct === 10 && it[0].tax_pct === 18 && it[1].billing === "monthly", it);
  const itext = await items.innerText();
  check("totals with discount and GST (₹2,12,400) and per month (₹17,700/mo)", /₹2,12,400/.test(itext) && /₹17,700\/mo/.test(itext), itext.slice(-300));
  await items.getByRole("button", { name: "Use these totals as the deal value" }).click();
  await page.waitForTimeout(1500);
  const v = await one("select value_amount::float as v, recurring_amount::float as r from sales_deals where id = $1", [deal]);
  check("deal value and recurring set from items", v.v === 212400 && v.r === 17700, v);

  const play = page.getByLabel("Stage playbook");
  check("discovery playbook with questions and checklist", /Walk me through how this works today/.test(await play.innerText()) && /Book the next step/.test(await play.innerText()));
  await play.getByLabel("Book the next step before the call ends").check();
  await page.waitForTimeout(1200);
  check("checklist tick saved on the deal", (await one("select checklist from sales_deals where id = $1", [deal])).checklist.discovery.includes("Book the next step before the call ends"));
  await play.getByRole("button", { name: "Call script" }).click();
  const script = await page.getByRole("dialog").innerText();
  check("call script opens with the contact's name, the purpose and the questions", /Hi R2,/.test(script) && /Front desk misses about 30 calls/i.test(script) && /Who else will weigh in/.test(script), script.slice(0, 200));
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Edit details" }).click();
  await choose(page, page.getByLabel("Owner"), /R2 Riya/);
  await page.getByRole("tab", { name: "Recurring" }).click();
  const end = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Contract end").fill(end);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(1500);
  const o = await one("select owner_id, to_char(contract_end, 'YYYY-MM-DD') as contract_end from sales_deals where id = $1", [deal]);
  check("owner and contract end saved", o.owner_id === riya.id && String(o.contract_end).slice(0, 10) === end, o);

  // won: then the renewal move appears and Insights counts recurring revenue
  await db.query("update sales_deals set stage_id = $2 where id = $1", [deal, await st("won")]);
  await go("/sales");
  check("renewal move on Moves", (await page.getByText(/Renewal: .*contract ends in (19|20) days/).count()) >= 1);
  await go("/sales/insights?days=90");
  const rec = await page.locator("section#recurring").innerText();
  check("Insights shows monthly recurring revenue and the renewal", /₹17,700/.test(rec) && /R2 Shah Dental/.test(rec), rec.slice(0, 300));
  check("Insights shows the stage-by-stage table", (await page.locator("section#stages").getByText("Pass rate", { exact: true }).count()) === 1);

  // ---- pipeline: tabs, fit column, bulk change, owner filter
  await go("/sales/pipeline");
  check("pipeline tabs listed", (await page.getByRole("navigation", { name: "Pipelines" }).getByText("R2 Retainers").count()) === 1);
  const b1 = (await one("insert into sales_deals (title, stage_id, pipeline_id) values ('R2 bulk one', $1, (select min(id) from sales_pipelines)) returning id", [await st("new")])).id;
  const b2 = (await one("insert into sales_deals (title, stage_id, pipeline_id) values ('R2 bulk two', $1, (select min(id) from sales_pipelines)) returning id", [await st("new")])).id;
  await go("/sales/pipeline");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByLabel("Select R2 bulk one").check();
  await page.getByLabel("Select R2 bulk two").check();
  const bar = page.getByRole("group", { name: "Bulk changes" });
  await choose(page, bar.getByLabel("Change"), /^Pipeline$/);
  await choose(page, bar.getByLabel("New value"), /R2 Retainers/);
  await bar.getByRole("button", { name: "Apply" }).click();
  await page.waitForTimeout(1800);
  check("bulk moved both deals to the other pipeline", (await all("select pipeline_id from sales_deals where id = any($1)", [[b1, b2]])).every((r) => r.pipeline_id === pipe.id));
  await go(`/sales/pipeline?p=${pipe.id}`);
  check("the other pipeline shows its deals, even in a stage it does not list", (await page.getByText("R2 bulk one").count()) === 1 && (await page.getByText("R2 bulk two").count()) === 1);
  check("and not the stages it does not use", (await page.locator("section h2", { hasText: "Discovery" }).count()) === 0);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: /^all$/i }).click();
  await page.waitForTimeout(400);
  check("its own stages are there", (await page.locator("section h2", { hasText: "Project live" }).count()) === 1, await page.locator("section h2").allInnerTexts());

  // ---- export and import
  const res = await ctx.request.get("http://localhost:3100/api/sales/export");
  const csv = await res.text();
  check("export is a CSV with every field", res.status() === 200 && /^ID,Deal name,Stage,Company/.test(csv) && csv.includes("R2 Shah Dental") && csv.includes("R2 Riya"), csv.slice(0, 120));
  const anon = await (await require("playwright").chromium.launch()).newContext();
  check("export refuses without sign-in", (await anon.request.get("http://localhost:3100/api/sales/export", { maxRedirects: 0 })).status() !== 200);
  await go("/sales/pipeline");
  const file = path.join(os.tmpdir(), "r2-import.csv");
  fs.writeFileSync(file, "Company Name,Contact,Mobile,Deal Value,City,Stage\nR2 Import Clinics,Dr Rao,+91 90000 00001,\"1,50,000\",Nagpur,Contacted\nR2 Lost Co,,,,,Lost\n");
  await page.getByLabel("Choose a CSV file").setInputFiles(file);
  await page.waitForTimeout(500);
  const dlg = page.getByRole("dialog");
  check("import matched the columns", /Company Name[\s\S]*Company/.test(await dlg.innerText()));
  await dlg.getByRole("button", { name: /^Import 2$/ }).click();
  await page.waitForTimeout(2500);
  const out = await dlg.innerText();
  check("import created 1 and listed the bad row", /1 deal imported, 1 skipped/.test(out) && /Row 3: .*closing stage/.test(out), out.slice(0, 200));
  const imp = await one("select d.city, d.value_amount::float as v, s.role from sales_deals d join sales_stages s on s.id = d.stage_id where d.title = 'R2 Import Clinics'");
  check("imported deal has city, value and stage", imp && imp.city === "Nagpur" && imp.v === 150000 && imp.role === "contacted", imp);

  // clean up
  await db.query("delete from sales_deals where title like 'R2 %' or id = any($1)", [[deal, b1, b2]]);
  await db.query("delete from sales_people where full_name like 'R2 %' or full_name = 'Dr Rao'");
  await db.query("delete from sales_companies where name like 'R2 %'");
  await db.query("delete from sales_team where name like 'R2 %'");
  await db.query("delete from sales_pipelines where name like 'R2 %'");
  await t.done();
})();
