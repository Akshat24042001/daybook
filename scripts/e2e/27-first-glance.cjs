// A lead at first glance: where it stands, the next step (changed in place) and logging at the top; everything else
// in tabs. A radar lead says what to do next and can be logged, which makes it a deal.
const { setup, check, U } = require("./lib.cjs");

(async () => {
  const { page, one, done } = await setup();
  const tag = Date.now().toString(36);
  const person = await one(`insert into sales_people (full_name, title, emails, phones, linkedin, city, country) values ($1, 'Founder', $2, $3, 'linkedin.com/in/asha-glance', 'Pune', 'India') returning id`,
    [`Asha ${tag}`, [`asha.${tag}@clinic.in`], ["+91 98765 43210"]]);
  const deal = await one(`insert into sales_deals (title, stage_id, next_action, person_id) values ($1, (select id from sales_stages where key = 'contacted'), 'Call them back', $2) returning id`, [`Glance ${tag}`, person.id]);
  await one("insert into sales_deal_people (deal_id, person_id, role) values ($1, $2, 'decision_maker') returning deal_id", [deal.id, person.id]);
  await page.goto(`${U}/sales/deal/${deal.id}`, { waitUntil: "networkidle" });

  const contact = page.getByLabel("Contact details");
  check("contacts are on top: number, WhatsApp, email, LinkedIn, place",
    (await contact.getByRole("link", { name: /\+91 98765 43210/ }).getAttribute("href")) === "tel:+919876543210"
    && (await contact.getByRole("link", { name: "WhatsApp" }).getAttribute("href")).startsWith("https://wa.me/919876543210")
    && (await contact.getByRole("link", { name: `asha.${tag}@clinic.in` }).getAttribute("href")).startsWith(`mailto:asha.${tag}@clinic.in`)
    && (await contact.getByRole("link", { name: "LinkedIn" }).getAttribute("href")) === "https://linkedin.com/in/asha-glance"
    && (await contact.innerText()).includes("Pune, India"));
  await page.getByRole("button", { name: "Share this lead" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("What will be shared").waitFor({ timeout: 15000 });
  const shared = await sheet.getByLabel("What will be shared").inputValue();
  check("a deal can be shared, contacts first", shared.includes("## Contacts") && shared.includes("+91 98765 43210") && shared.indexOf("## Contacts") < shared.indexOf("## Next step"));
  check("and sent on WhatsApp", (await sheet.getByRole("link", { name: "Send on WhatsApp" }).getAttribute("href")).startsWith("https://wa.me/?text="));
  await page.keyboard.press("Escape");
  const stands = page.getByLabel("Where it stands");
  check("where it stands is on top", await stands.isVisible() && (await stands.innerText()).includes("Contacted"));
  const next = page.locator('[aria-label="Next step"]').first();
  check("the next step is on top", (await next.innerText()).includes("Call them back"));
  check("logging is on top", await page.getByLabel("Log something").isVisible());
  check("the details are in tabs, not on the first screen", await page.getByRole("tab", { name: /Details/ }).isVisible() && !(await page.getByRole("tabpanel", { name: "Details" }).isVisible().catch(() => false)));

  await next.getByRole("button", { name: "Change" }).click();
  await page.getByRole("textbox", { name: "Next step" }).fill(`Send proposal ${tag}`);
  await next.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1500);
  check("next step changed in place", (await one("select next_action from sales_deals where id = $1", [deal.id])).next_action === `Send proposal ${tag}`);

  // Mark done logs it on the timeline and asks for the next step
  await next.getByRole("button", { name: "Mark done" }).click();
  await page.getByRole("textbox", { name: "Next step" }).waitFor({ timeout: 10000 });
  const doneRow = await one("select channel, summary from sales_interactions where deal_id = $1 and summary like 'Done: Send proposal%'", [deal.id]);
  check("Mark done logs the step on the timeline", !!doneRow, doneRow);
  check("and the next step is cleared, asking for the new one", (await one("select next_action from sales_deals where id = $1", [deal.id])).next_action === null);
  // ticking a move after sending it on WhatsApp logs it there, with the message
  const mv = await one("insert into sales_moves (deal_id, kind, title, draft, channel, dedupe_key) values ($1, 'follow_up', $2, 'Hi Asha, did you see the plan?', 'whatsapp', $3) returning id", [deal.id, `Follow up ${tag}`, `e2e-done-${tag}`]);
  await page.reload({ waitUntil: "networkidle" });
  const card = page.locator("li", { hasText: `Follow up ${tag}` }).first();
  await card.getByRole("button", { name: "Done", exact: true }).click();
  await page.waitForTimeout(1500);
  const sent = await one("select channel, body from sales_interactions where external_id = $1", [`move:${mv.id}`]);
  check("ticking a move done logs it on WhatsApp with the message", sent && sent.channel === "whatsapp" && sent.body.includes("did you see the plan"), sent);
  await page.getByRole("tab", { name: /Details/ }).click();
  check("a tab opens its part", await page.getByRole("tabpanel", { name: "Details" }).getByText("Deal details").first().isVisible());
  await page.getByRole("tab", { name: /History/ }).click();
  check("another tab", await page.getByRole("tabpanel", { name: "History" }).getByText("Journey").first().isVisible());
  await page.reload({ waitUntil: "networkidle" });
  check("the last tab is remembered", (await page.getByRole("tab", { name: /History/ }).getAttribute("aria-selected")) === "true");
  await page.goto(`${U}/sales/deal/${deal.id}#documents`, { waitUntil: "networkidle" });
  check("a #documents link opens that tab", (await page.getByRole("tab", { name: /Documents/ }).getAttribute("aria-selected")) === "true");

  const lead = await one(`insert into sales_radar_items (url, url_hash, title, body, status, score, identity) values ($1, md5($1), $2, 'Need a WhatsApp bot for our clinic', 'qualified', 90, $3) returning id`,
    [`https://e2e.example/glance-${tag}`, `Clinic bot ${tag}`, JSON.stringify({ status: "found", person: "Asha", emails: [`asha${tag}@clinic.in`], phones: [], evidence: [], candidates: [] })]);
  await page.goto(`${U}/sales/radar?lead=${lead.id}`, { waitUntil: "networkidle" });
  const pane = page.getByLabel("Selected lead");
  check("the lead says what to do next", (await pane.locator('[aria-label="Next step"]').innerText()).length > 20);
  await pane.getByRole("button", { name: "Log what you did" }).click();
  await pane.getByLabel("What happened").fill(`Sent the intro on email ${tag}`);
  await pane.getByRole("button", { name: "Log it" }).click();
  await page.waitForURL(/\/sales\/deal\/\d+/, { timeout: 15000 });
  const made = await one("select deal_id from sales_radar_items where id = $1", [lead.id]);
  check("logging a radar lead makes it a deal", !!made.deal_id);
  check("with what you did on record", !!(await one("select 1 as x from sales_interactions where deal_id = $1 and body like $2", [made.deal_id, `%${tag}%`])));
  await done();
})();
