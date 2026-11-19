// The internal prep note opens (and only for you), and the opportunity audit says what it was built on and when it is out of date.
const { chromium } = require("playwright");
const { setup, check, U } = require("./lib.cjs");

(async () => {
  const { page, one, go, done } = await setup();
  const tag = Date.now().toString(36);
  const stage = await one("select id from sales_stages where category = 'open' order by sort limit 1");
  const co = await one("insert into sales_companies (name, audit, audited_at) values ($1, $2, now()) returning id",
    [`E2E Prep Co ${tag}`, JSON.stringify({ summary: "They want WhatsApp booking.", opportunities: [{ title: "WhatsApp booking", fix: "an agent", impact: "~10 hrs/week", effort: "weeks" }], first_project: "WhatsApp booking agent",
      based_on: { hash: "old", at: new Date().toISOString(), said: true, research: false, website: null } })]);
  const deal = await one("insert into sales_deals (title, company_id, stage_id, requirements) values ($1, $2, $3, 'WhatsApp booking for the salon') returning id", [`E2E Prep ${tag}`, co.id, stage.id]);
  const doc = await one("insert into sales_docs (slug, kind, deal_id, company_id, title, body, category, internal) values ($1, 'brief', $2, $3, $4, $5, 'prep', true) returning id, slug",
    [`prep${tag}`, deal.id, co.id, "Prep: prepare the demo", "## What they told us\n- WhatsApp booking\n\n## Steps\n1. Build the flow"]);

  await go(`/sales/deal/${deal.id}`);
  const link = page.getByRole("link", { name: /Prep: prepare the demo/ }).first();
  check("prep note links to the document page, not the file download", (await link.getAttribute("href")) === `/sales/docs/${doc.id}`, await link.getAttribute("href"));
  await page.waitForTimeout(500); // the sections finish opening
  await link.scrollIntoViewIfNeeded();
  await Promise.all([page.waitForURL(`**/sales/docs/${doc.id}`, { timeout: 15000 }).catch(() => {}), link.click()]);
  // a click that lands while the page is still settling is tried once more
  if (!page.url().endsWith(`/sales/docs/${doc.id}`)) {
    await page.waitForLoadState("networkidle");
    await Promise.all([page.waitForURL(`**/sales/docs/${doc.id}`, { timeout: 15000 }).catch(() => {}), page.getByRole("link", { name: /Prep: prepare the demo/ }).first().click()]);
  }
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const body = await page.locator("main").innerText();
  check("the note opens", page.url().endsWith(`/sales/docs/${doc.id}`) && body.includes("Prep: prepare the demo"), page.url());
  check("marked internal, not 'send this link'", body.includes("Internal: only you can open this") && !body.includes("Send this link instead of a PDF"));
  check("reads as a document (rendered headings)", (await page.locator("article :is(h2,h3,h4)", { hasText: "What they told us" }).count()) === 1 && (await page.locator("article li", { hasText: "WhatsApp booking" }).count()) === 1);

  // nobody else can open it, even with the link
  const browser = await chromium.launch();
  const anon = await browser.newContext();
  const res = await anon.request.get(`${U}/q/${doc.slug}`);
  check("a stranger with the link gets nothing", res.status() === 404, res.status());
  await browser.close();

  // the audit says what it was built on, and that it is out of date (the requirement changed since)
  await go(`/sales/deal/${deal.id}`);
  const audit = page.locator('[data-fold-section="audit"], section', { hasText: "Opportunity audit" }).first();
  const text = await page.locator("main").innerText();
  check("audit shows what it was built on", /Built on what they told you, no website found/.test(text), text.match(/Built on[^\n]*/)?.[0]);
  check("audit says it is out of date", /Out of date: they have told you more since/.test(text));
  check("audit can be rebuilt", await page.getByRole("button", { name: "Rebuild now" }).isVisible());
  void audit;
  await done();
})();
