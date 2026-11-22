// News: the morning paper by date (front page, who wins and who loses, sections, each story opening in place, with its PDF),
// every story with why it matters, sources with their health, settings.
const { setup, check, choose, U } = require("./lib.cjs");

(async () => {
  const { page, one, go, done, db } = await setup();
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await db.query("delete from news_editions where date = $1", [day]);
  await db.query("delete from news_items where url like 'https://e2e.news/%'");
  await db.query(`insert into news_items (url, url_hash, title_key, title, outlet, score, topic, why, action, scored_at) values
    ('https://e2e.news/gemini', md5('e2e-gemini'), 'e2e gemini prices', 'E2E: Gemini cuts API prices by half', 'The Verge', 93, 'ai_models', 'Cheaper Gemini lowers the cost of your voice agents', 'Check your API bill', now()),
    ('https://e2e.news/rbi', md5('e2e-rbi'), 'e2e rbi holds', 'E2E: RBI holds the repo rate', 'ET', 81, 'india_economy', 'Loan costs stay flat for your clients', null, now())`);
  const ids = (await db.query("select id from news_items where url like 'https://e2e.news/%' order by score desc")).rows.map((r) => r.id);
  await db.query(`update news_items set detail = 'Google halved the price of Gemini Flash for developers from Monday.', affects = 'AI agencies and SaaS firms building on Gemini.',
    impact = 'up', for_you = 'Your voice agents get cheaper to run this month.', author = 'Tom Lee', real_url = 'https://e2e.news/gemini-full' where id = $1`, [ids[0]]);
  await db.query("update news_items set detail = 'The RBI kept the repo rate unchanged.', impact = 'none' where id = $1", [ids[1]]);
  const layout = { v: 2, headline: "E2E: Gemini prices halved", standfirst: "Your agents get cheaper.", lead: ids[0], brief: [{ text: "The RBI held rates.", id: ids[1] }],
    glance: "A calm day for markets.", note: "Watch the rupee.", sectors: [{ name: "AI agencies", move: "up", why: "Cheaper models.", ids: [ids[0]] }],
    opportunities: [{ idea: "Pitch cheaper voice agents.", id: ids[0] }], today: ["Check your API bill"], sections: [{ key: "economy", title: "Economy and markets", ids: [ids[1]] }] };
  await db.query("insert into news_editions (date, title, markdown, stories, layout, item_ids) values ($1, 'Aivaura Morning Brief, E2E', '# E2E', 2, $2, $3)", [day, JSON.stringify(layout), ids]);

  await go("/news");
  const paper = page.getByLabel("Today's paper");
  const text = await paper.innerText();
  check("the paper shows: masthead, headline, the lead story told in full", /The Daybook Daily/.test(text) && text.includes("E2E: Gemini prices halved") && text.includes("Google halved the price") && text.includes("Your voice agents get cheaper to run"));
  check("each story links to its full article at the source", (await paper.getByRole("link", { name: /Read the full story at The Verge/ }).getAttribute("href")) === "https://e2e.news/gemini-full");
  check("who wins and who loses, and what to do", text.includes("AI agencies") && text.includes("Pitch cheaper voice agents") && text.includes("Check your API bill"));
  const rbi = page.locator(`[data-story="${ids[1]}"]`);
  check("a section story starts closed", (await rbi.getByRole("button", { name: "E2E: RBI holds the repo rate" }).getAttribute("aria-expanded")) === "false");
  await paper.getByRole("button", { name: "ET ›" }).first().click();
  await page.waitForTimeout(500);
  check("a brief point opens its story", (await rbi.getByRole("button", { name: "E2E: RBI holds the repo rate" }).getAttribute("aria-expanded")) === "true" && (await rbi.innerText()).includes("Loan costs stay flat"));
  const pdf = await page.request.get(`${U}/api/news/pdf/${day}`);
  const body = await pdf.body();
  check("the PDF opens: the newspaper, with clickable sources", pdf.ok() && pdf.headers()["content-type"] === "application/pdf" && body.slice(0, 5).toString() === "%PDF-" && body.toString("latin1").includes("/URI (https://e2e.news/gemini-full)"));
  check("the PDF needs your login", (await (await require("playwright").request.newContext()).get(`${U}/api/news/pdf/${day}`)).status() === 401);

  await page.getByRole("tab", { name: "All stories" }).click();
  check("every story with why it matters", (await page.getByText("Cheaper Gemini lowers the cost of your voice agents").count()) === 1 && (await page.getByText("Check your API bill").count()) >= 1);
  await page.locator("li", { hasText: "E2E: Gemini cuts API prices by half" }).getByRole("button", { name: "Star" }).click();
  await page.waitForTimeout(1200);
  check("a story can be starred", !!(await one("select 1 as x from news_items where url = 'https://e2e.news/gemini' and starred")));

  await page.getByRole("tab", { name: "Sources" }).click();
  check("sources are listed with whether they work", (await page.getByText("New AI tools launched").count()) === 1);
  await page.getByLabel("New source").fill("E2E Tata Elxsi results");
  await page.getByLabel("New source").locator("xpath=..").getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(1500);
  check("your own source is added as a Google News search", !!(await one("select 1 as x from news_sources where custom and config->>'q' like 'E2E Tata Elxsi results%'")));

  await page.getByRole("tab", { name: "Settings" }).click();
  await choose(page, page.getByLabel("Hour"), "07:00");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1200);
  check("the hour is saved", (await one("select send_hour from news_settings where id = 1")).send_hour === 7);
  await db.query("update news_settings set send_hour = 8 where id = 1");
  await db.query("delete from news_sources where custom and config->>'q' like 'E2E%'");
  await db.query("delete from news_items where url like 'https://e2e.news/%'");
  await done();
})();
