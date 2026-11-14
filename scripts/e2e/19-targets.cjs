const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup({ width: 1440, height: 1000 });
  const { page, one, go, db } = t;
  console.log("Targets and trips: one line in, a trip card with a day-by-day plan, its leads on the board, a meeting booked");
  const clean = async () => {
    await db.query("delete from sales_meetings where radar_item_id in (select id from sales_radar_items where url like 'https://e2e.trip/%')");
    await db.query("delete from sales_deals where radar_item_id in (select id from sales_radar_items where url like 'https://e2e.trip/%')");
    await db.query("delete from sales_radar_items where url like 'https://e2e.trip/%'");
    await db.query("delete from sales_hunts where name like 'E2E%' or name = 'Udaipur trip'");
  };
  await clean();
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = (n) => { const d = new Date(Date.now() + n * 86400000); return { iso: d.toISOString().slice(0, 10), words: `${d.getUTCDate()} ${M[d.getUTCMonth()]}` }; };
  const from = day(15), to = day(18);

  await go("/sales/radar");
  await page.getByRole("button", { name: /Targets & trips/ }).click();
  await page.getByLabel("What to target").fill(`I'm traveling to Udaipur from ${from.words} to ${to.words}, hotels and wedding planners`);
  await page.getByRole("button", { name: "Set it up" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByText("Here is what I understood").waitFor();
  check("the line becomes a trip form to check", (await sheet.getByRole("button", { name: "A trip", pressed: true }).count()) === 1
    && (await sheet.getByLabel("City").inputValue()) === "Udaipur" && (await sheet.getByLabel("First day").inputValue()) === from.iso && (await sheet.getByLabel("Last day").inputValue()) === to.iso);
  check("a trip asks to meet and finds local businesses by default", await sheet.getByLabel(/ask to meet in person/i).isChecked() && await sheet.getByLabel(/find local businesses/i).isChecked());
  await sheet.getByRole("button", { name: "Start the trip search" }).click();
  const card = page.getByRole("listitem", { name: "Udaipur trip" });
  await card.waitFor();
  const ct = await card.innerText();
  check("the trip card counts down and shows the dates", /In 15 days · \d+ \w{3}( to | \w{3} to )\d+ \w{3} · Udaipur/.test(ct), ct.split("\n").slice(0, 3));
  check("its day-by-day plan lists every day, all free", (await card.getByRole("list", { name: "Trip plan" }).getByRole("listitem").count()) === 4 && /free/.test(ct));
  const hunt = await one("select id, kind, cities, meet, prospects, sweep_sources, to_char(ends_on, 'YYYY-MM-DD') as ends_on from sales_hunts where name = 'Udaipur trip'");
  check("saved as a trip that stops on its last day", hunt.kind === "trip" && hunt.cities[0] === "Udaipur" && hunt.meet && hunt.prospects && !hunt.sweep_sources && hunt.ends_on === to.iso, hunt);
  check("its first search is queued right away", !!(await one("select 1 as x from sales_jobs where kind = 'hunt_run' and (payload->>'id')::int = $1", [hunt.id])));

  // a local business the trip found
  const lead = await one(`insert into sales_radar_items (url, url_hash, title, body, status, score, found_at, hunt_id, lead_kind, fit)
    values ('https://e2e.trip/haveli', md5('https://e2e.trip/haveli'), 'E2E Lake Haveli, Udaipur (Hotels)', 'Local business found for this target.', 'qualified', 74, now(), $1, 'prospect', '{"company":"E2E Lake Haveli","why":"Guests book on WhatsApp"}') returning id`, [hunt.id]);
  await go("/sales/radar");
  await page.getByRole("button", { name: /Targets & trips/ }).click();
  await page.getByRole("listitem", { name: "Udaipur trip" }).getByRole("button", { name: "See its leads" }).click();
  const list = page.getByRole("listbox", { name: "Leads" });
  await list.getByRole("option").first().waitFor();
  const rows = await list.getByRole("option").allInnerTexts();
  check("See its leads shows only this trip's leads", rows.length === 1 && rows[0].includes("E2E Lake Haveli"), rows.length);
  check("the row says trip and local business", /Udaipur trip/.test(rows[0]) && /local business/.test(rows[0]));
  const pane = page.getByRole("article", { name: "Selected lead" }).first();
  const pt = await pane.innerText();
  check("the lead shows the trip countdown and that nobody posted it", /Udaipur trip · in 15 days/.test(pt) && /nobody posted this/.test(pt));
  await pane.getByRole("button", { name: "Book a meeting in Udaipur" }).click();
  const book = pane.getByLabel("Book a meeting");
  check("booking starts on the first day of the trip", (await book.getByLabel("Day").inputValue()) === from.iso);
  await book.getByLabel("Day").fill(day(16).iso);
  await book.getByLabel("Time").fill("11:30");
  await book.getByRole("button", { name: "Book it" }).click();
  await page.getByText(/Meeting booked/).first().waitFor();
  const m = await one("select title, place, deal_id, to_char(starts_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as at from sales_meetings where radar_item_id = $1", [lead.id]);
  check("the meeting is saved at the time you picked, with a deal", m && m.at === `${day(16).iso} 11:30` && m.deal_id && m.place === "Udaipur", m);
  await page.getByRole("button", { name: /Targets & trips/ }).click();
  const plan = page.getByRole("listitem", { name: "Udaipur trip" }).getByRole("list", { name: "Trip plan" });
  await plan.waitFor();
  const planText = await plan.innerText();
  check("the trip plan shows it on its day", /1 meeting[\s\S]*11:30[\s\S]*Meet E2E Lake Haveli in Udaipur/.test(planText), planText.slice(0, 200));
  { const cardText = await page.getByRole("listitem", { name: "Udaipur trip" }).innerText(); check("the card counts the meeting", /1\s*Meetings/.test(cardText), cardText.split("\n").slice(0, 16).join(" | ")); }

  // an ongoing target with a city and words to skip, on a phone
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /An industry or anything else/ }).click();
  const s2 = page.getByRole("dialog");
  await s2.getByLabel("Name").fill("E2E Jaipur jewellers");
  await s2.getByLabel(/Who do you want to find/).fill("Jewellery exporters in Jaipur who take orders on WhatsApp");
  await s2.getByLabel(/^Cities/).fill("Jaipur");
  await s2.getByLabel(/Skip anything that mentions/).fill("internship, crypto");
  await s2.getByLabel(/Stop after/).fill(day(30).iso);
  await s2.getByRole("button", { name: "Start this target" }).click();
  await page.getByRole("listitem", { name: "E2E Jaipur jewellers" }).waitFor();
  const j = await one("select kind, cities, exclude, to_char(ends_on, 'YYYY-MM-DD') as ends_on from sales_hunts where name = 'E2E Jaipur jewellers'");
  check("an ongoing target keeps its city, skip words and end date", j.kind === "standing" && j.cities[0] === "Jaipur" && j.exclude.join() === "internship,crypto" && j.ends_on === day(30).iso, j);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no sideways scroll on a phone", !wide);
  await clean();
  await t.done();
})();
