const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, go } = t;
  console.log("Sales chat (pipeline and one lead), mic on deal fields");
  const deal = (await one("select id, title from sales_deals where title = 'Shah Dental: WhatsApp booking'")) ?? (await one("select id, title from sales_deals order by id limit 1"));

  await go("/sales/pipeline");
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Chat about sales" });
  await sheet.waitFor();
  check("pipeline chat opens with starter questions", await sheet.getByRole("button", { name: "Who needs me most today?" }).isVisible());
  check("chat has a mic", (await sheet.getByRole("button", { name: /Speak/ }).count()) >= 1);
  // no AI key on this test server: asking must fail with a message, never crash
  const errs = t.errors.length;
  await sheet.getByLabel("Message").fill("Who needs me most today?");
  await sheet.getByRole("button", { name: "Send" }).click();
  await sheet.getByRole("alert").waitFor({ timeout: 10000 }).catch(() => {});
  check("without an AI key the chat says why", /OPENROUTER|AI|assistant/i.test(await sheet.getByRole("alert").innerText().catch(() => "")));
  t.errors.splice(errs); // the 503 itself is logged by the browser
  await page.keyboard.press("Escape");

  await go(`/sales/deal/${deal.id}`);
  await page.getByRole("button", { name: "Chat about this lead" }).click();
  const dsheet = page.getByRole("dialog", { name: `Chat about ${deal.title}` });
  await dsheet.waitFor();
  check("lead chat opens with lead starters", await dsheet.getByRole("button", { name: /What's the latest with them/ }).isVisible());
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Edit details" }).click();
  await page.waitForTimeout(400);
  const mics = await page.getByRole("button", { name: "Speak into this field" }).count();
  check("edit details: text fields have a mic", mics >= 3, mics);
  await t.done();
})();
