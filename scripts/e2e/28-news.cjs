// News: the morning brief by date (with its PDF), every story with why it matters, sources with their health, settings.
const { setup, check, choose, U } = require("./lib.cjs");

(async () => {
  const { page, one, go, done, db } = await setup();
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await db.query("delete from news_editions where date = $1", [day]);
  await db.query("delete from news_items where url like 'https://e2e.news/%'");
  await db.query(`insert into news_items (url, url_hash, title_key, title, outlet, score, topic, why, action, scored_at) values
    ('https://e2e.news/gemini', md5('e2e-gemini'), 'e2e gemini prices', 'E2E: Gemini cuts API prices by half', 'The Verge', 93, 'ai_models', 'Cheaper Gemini lowers the cost of your voice agents', 'Check your API bill', now()),
    ('https://e2e.news/rbi', md5('e2e-rbi'), 'e2e rbi holds', 'E2E: RBI holds the repo rate', 'ET', 81, 'india_economy', 'Loan costs stay flat for your clients', null, now())`);
  await db.query("insert into news_editions (date, title, markdown, stories) values ($1, $2, $3, 2)", [day, "Aivaura Morning Brief, E2E",
    "# Aivaura Morning Brief, E2E\n## The 60-second brief\n- **Gemini** cut API prices by half: your voice agents get cheaper. [The Verge](https://e2e.news/gemini)\n## Markets: India\n- **RBI** held the repo rate. [ET](https://e2e.news/rbi)\n## Do today\n- Check your API bill"]);

  await go("/news");
  const brief = page.getByLabel("Morning brief");
  const text = await brief.innerText();
  check("the brief shows, by date", text.includes("Aivaura Morning Brief, E2E") && /Gemini/.test(text) && /MARKETS: INDIA|Markets: India/i.test(text));
  check("its sources are links", (await brief.getByRole("link", { name: "The Verge" }).getAttribute("href")) === "https://e2e.news/gemini");
  const pdf = await page.request.get(`${U}/api/news/pdf/${day}`);
  check("the PDF opens", pdf.ok() && pdf.headers()["content-type"] === "application/pdf" && (await pdf.body()).slice(0, 5).toString() === "%PDF-");
  check("the PDF needs your login", (await (await require("playwright").request.newContext()).get(`${U}/api/news/pdf/${day}`)).status() === 401);

  await page.getByRole("tab", { name: "All stories" }).click();
  check("every story with why it matters", (await page.getByText("Cheaper Gemini lowers the cost of your voice agents").count()) === 1 && (await page.getByText("Check your API bill").count()) >= 1);
  await page.getByRole("button", { name: "Star" }).first().click();
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
