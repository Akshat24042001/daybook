const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup({ width: 1440, height: 1000 });
  const { page, ctx, one, go, db } = t;
  console.log("Share a lead: everything in one go, four versions, copy, WhatsApp, Claude, download");
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3100" });
  const clean = () => db.query("delete from sales_radar_items where url like 'https://e2e.share/%'");
  await clean();
  await db.query("update sales_radar_items set hidden = true where status = 'qualified'");
  const it = await one(`insert into sales_radar_items (url, url_hash, title, body, status, score, posted_at, found_at, poster, identity, brief, fit)
    values ('https://e2e.share/1', md5('https://e2e.share/1'), 'E2E: Booking bot for a salon chain', 'We run 4 salons in Pune and lose bookings on Instagram.', 'qualified', 81, now(), now(),
      '{"name":"Meera K.","city":"Pune","country":"India"}',
      '{"status":"found","company":"Glow Salons","website":"https://glowsalons.in","person":"Meera Kapoor","title":"Owner","emails":["meera@glowsalons.in"],"phones":["+91 98111 22222"],"confidence":"high","evidence":[],"note":"n","checked_at":"x"}',
      '{"need":"Take salon bookings from Instagram and WhatsApp automatically.","deliverables":["Booking agent"],"help":["Start with one salon"],"offers":["AI agents"],"questions":["Which booking tool?"],"opener":"Saw your 4 salons lose bookings.","size":"small","budget":null,"timing":null,"watch_out":null}',
      '{"why":"fits","country":"India"}') returning id`);
  await go("/sales/radar");
  const pane = page.getByRole("article", { name: "Selected lead" }).first();
  await pane.getByRole("button", { name: "Share this lead" }).click();
  const sheet = page.getByRole("dialog");
  const box = sheet.getByLabel("What will be shared");
  await box.waitFor();
  const full = await box.inputValue();
  check("full details: contacts, who posted it, business, need, help, the post", /# E2E: Booking bot for a salon chain[\s\S]*## Reach them[\s\S]*meera@glowsalons.in[\s\S]*## Who posted it[\s\S]*Meera K\.[\s\S]*## The business behind it[\s\S]*Glow Salons[\s\S]*## What they need[\s\S]*## How we can help[\s\S]*## Their post, word for word/.test(full), full.slice(0, 200));
  await sheet.getByRole("tab", { name: "WhatsApp" }).click();
  const wa = await box.inputValue();
  check("WhatsApp version is short and formatted", wa.startsWith("*E2E: Booking bot") && /\*Reach:\* meera@glowsalons.in/.test(wa) && wa.length < 3500);
  const href = await sheet.getByRole("link", { name: "Send on WhatsApp" }).getAttribute("href");
  check("Send on WhatsApp opens WhatsApp with the message", href.startsWith("https://wa.me/?text=") && decodeURIComponent(href).includes("Glow Salons"));
  await sheet.getByRole("tab", { name: "For Claude" }).click();
  check("the Claude version says what to do and not to invent", /^I am [\s\S]*Never invent names, emails, phone numbers or facts/.test(await box.inputValue()));
  await sheet.getByRole("tab", { name: "Data" }).click();
  check("the data version is valid JSON with everything", JSON.parse(await box.inputValue()).identity.company === "Glow Salons");
  await sheet.getByRole("tab", { name: "Full details" }).click();
  await sheet.getByRole("button", { name: "Copy" }).click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("Copy puts the whole lead on the clipboard", clip === full);
  const [dl] = await Promise.all([page.waitForEvent("download"), sheet.getByRole("button", { name: /Download \.md/ }).click()]);
  check("Download gives a named file", dl.suggestedFilename() === `lead-${it.id}-e2e-booking-bot-for-a-salon-chain.md`);
  const mail = await sheet.getByRole("link", { name: "Email it" }).getAttribute("href");
  check("Email it fills the subject and body", mail.startsWith("mailto:?subject=Lead%3A%20E2E") && decodeURIComponent(mail).includes("Glow Salons"));
  await page.keyboard.press("Escape");
  const msgBox = pane.getByLabel("Your first message");
  check("the first message is shown on the lead, not hidden behind a copy button", (await msgBox.innerText()).includes("Saw your 4 salons lose bookings."));
  const emailHref = decodeURIComponent(await pane.getByRole("link", { name: /Email meera@glowsalons.in/ }).getAttribute("href"));
  check("Email sends the whole message, and hovering shows it", emailHref.includes("Hi Meera,") && emailHref.includes("Saw your 4 salons lose bookings.") && (await pane.getByRole("link", { name: /Email meera@glowsalons.in/ }).getAttribute("title")).includes("Saw your 4 salons"));
  // a lead's chat takes screenshots
  const deal = await one("insert into sales_deals (title, stage_id, source) select 'E2E share chat deal', id, 'outbound' from sales_stages where role = 'new' returning id");
  await db.query(`update sales_deals set conversation = $2 where id = $1`, [deal.id, JSON.stringify({ quick_actions: [], reply_draft: null, at: new Date().toISOString(), autopilot: { at: new Date().toISOString(), items: [{ label: "Message being written: Reply to Neha", href: "/sales/moves" }, { label: "Prep note ready: Prepare the demo" }] } })]);
  await db.query("insert into sales_interactions (deal_id, channel, direction, body, occurred_at, source) values ($1,'linkedin','in','Here are the clinic details', now(),'web')", [deal.id]);
  await go(`/sales/deal/${deal.id}`);
  const done = page.getByLabel("Done for you");
  check("the deal shows what was done for you", (await done.count()) > 0 && /Message being written: Reply to Neha[\s\S]*Prep note ready/.test(await done.first().innerText()));
  await page.getByRole("button", { name: /Chat|Ask about this lead/ }).first().click();
  check("a lead's chat has a Screenshot button", await page.getByRole("dialog").getByRole("button", { name: "Screenshot" }).isVisible());
  check("and makes changes right away by default (each can be undone)", await page.getByRole("dialog").getByLabel("Apply changes right away").isChecked());
  await page.keyboard.press("Escape");
  await db.query("delete from sales_deals where id = $1", [deal.id]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  check("no sideways scroll on a phone", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await clean();
  await db.query("update sales_radar_items set hidden = false where status = 'qualified' and hidden");
  await t.done();
})();
