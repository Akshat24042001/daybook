const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, all, go, db } = t;
  console.log("Playbook > Objections and Proof (no AI key on this server)");
  await db.query("delete from sales_deal_objections; delete from sales_objections; delete from sales_proofs; update sales_deals set objections = '{}'");
  const won = (await one("select d.id from sales_deals d join sales_stages s on s.id = d.stage_id where s.category = 'won' order by d.id limit 1")).id;
  const lost = (await one("select d.id from sales_deals d join sales_stages s on s.id = d.stage_id where s.category = 'lost' order by d.id limit 1")).id;
  await db.query("update sales_deals set objections = $2 where id = $1", [won, ["too expensive", "need to check with my partner"]]);
  await db.query("update sales_deals set objections = $2 where id = $1", [lost, ["Too expensive"]]);

  await go("/sales/playbook");
  const ob = page.locator("section#objections");
  check("banner counts 3 ungrouped objections", (await ob.getByText(/3 new objections from your conversations/).count()) === 1);
  await ob.getByRole("button", { name: "Group now" }).click();
  await page.waitForTimeout(2000);
  const rows = await all("select o.label, count(*)::int as n from sales_objections o join sales_deal_objections x on x.objection_id = o.id group by o.label order by o.label");
  check("without AI, same wording groups together, nothing lost", JSON.stringify(rows) === JSON.stringify([{ label: "Need to check with my partner", n: 1 }, { label: "Too expensive", n: 2 }]), rows);
  // the list refreshes after the server action: wait for it rather than a fixed delay
  await ob.locator("li", { hasText: "Too expensive" }).getByText(/1 won · 1 lost · 0 open · 50% won/).waitFor({ timeout: 8000 }).catch(() => {});
  await ob.getByText(/new objections? from your conversations/).waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  check("outcomes shown: 2 deals, 1 won, 1 lost, 50% won", (await ob.locator("li", { hasText: "Too expensive" }).getByText(/1 won · 1 lost · 0 open · 50% won/).count()) === 1);
  check("banner gone after grouping", (await ob.getByText(/new objections? from your conversations/).count()) === 0);

  const item = ob.locator("li", { hasText: "Too expensive" });
  await item.getByLabel("Answer to Too expensive").fill("Fair. What does one lost order cost you a week? Let's start with a two-week pilot.");
  await item.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1500);
  const a = await one("select answer, answer_source from sales_objections where label = 'Too expensive'");
  check("answer saved as yours", a.answer.startsWith("Fair.") && a.answer_source === "me", a);
  await item.getByText("Your answer").waitFor({ timeout: 8000 }).catch(() => {});
  check("'Your answer' shown", (await item.getByText("Your answer").count()) === 1);

  await item.getByRole("button", { name: "Suggest" }).click();
  await page.waitForTimeout(1500);
  check("Suggest without an AI key explains why, does not break", (await page.getByText(/Suggestions need an AI key/).count()) > 0);
  check("your saved answer untouched by the failed suggestion", (await one("select answer_source from sales_objections where label = 'Too expensive'")).answer_source === "me");

  // rename onto an existing label merges
  const partner = ob.locator("li", { hasText: "Need to check with my partner" });
  await partner.getByRole("button", { name: /Rename/ }).click();
  await partner.getByLabel("Objection name").fill("Too expensive");
  await partner.locator("form").getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1500);
  const after = await all("select label from sales_objections");
  check("rename onto an existing one merges them", after.length === 1 && after[0].label === "Too expensive", after);
  check("merged entry keeps your answer", (await one("select answer from sales_objections")).answer.startsWith("Fair."));

  // proof
  const pr = page.locator("section#proof");
  await go("/sales/playbook");
  const waiting = (await one(`select count(*)::int as n from sales_deals d join sales_stages s on s.id = d.stage_id where s.role in ('delivered','paid')`)).n;
  check("banner counts delivered/paid deals without a case study", (await pr.getByText(new RegExp(`${waiting} delivered or paid deal`)).count()) === 1, waiting);
  await pr.getByRole("button", { name: "Draft now" }).click();
  await page.waitForTimeout(2500);
  const drafts = await all("select title, status, problem, solution, result, client from sales_proofs");
  check("drafts written from the deals' own fields, no invented result", drafts.length === Math.min(5, waiting) && drafts.every((d) => d.status === "draft" && d.result === null), drafts);
  if (drafts.length) await pr.getByText("No result recorded yet.").nth(drafts.length - 1).waitFor({ timeout: 10000 }).catch(() => {});
  check("drafts show 'No result recorded yet'", (await pr.getByText("No result recorded yet.").count()) === drafts.length, { shown: await pr.getByText("No result recorded yet.").count(), drafts: drafts.length });

  // approving without the problem and the solution is refused
  const firstCard = pr.locator("div.rounded-lg", { hasText: drafts[0].title }).first();
  await firstCard.getByRole("button", { name: "Edit" }).click();
  await pr.getByLabel("The problem before").fill("");
  await pr.getByLabel("Status").click();
  await page.getByRole("option", { name: /Approved/ }).click();
  await pr.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(1200);
  check("approve without the problem refused with a message", (await page.getByText(/Add the problem and what you built/).count()) > 0);
  await pr.getByLabel("The problem before").fill("Orders on WhatsApp got lost.");
  await pr.getByLabel("What you built").fill("An agent that files every order into their sheet.");
  await pr.getByLabel("The result").fill("Zero lost orders in the first month.");
  await pr.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(1500);
  check("approved with problem, solution, result", (await all("select 1 from sales_proofs where status = 'approved' and result = 'Zero lost orders in the first month.'")).length === 1);

  // add a manual case study, then delete it
  await pr.getByRole("button", { name: "Add a case study" }).click();
  await pr.getByLabel("Title").fill("Manual case");
  await pr.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(1500);
  check("manual case study saved as draft", (await all("select 1 from sales_proofs where title = 'Manual case' and status = 'draft' and deal_id is null")).length === 1);
  await pr.locator("div.rounded-lg", { hasText: "Manual case" }).first().getByRole("button", { name: "Delete" }).click();
  await page.waitForTimeout(1500);
  check("case study deleted", (await all("select 1 from sales_proofs where title = 'Manual case'")).length === 0);
  await t.done();
})().catch((e) => { console.error(e); process.exit(2); });
