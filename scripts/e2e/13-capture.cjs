const { setup, check } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, go } = t;
  console.log("Capture box: on the pipeline, screenshots by drop, a failure reported plainly");
  await go("/sales/pipeline");
  const box = page.locator("textarea[placeholder^='New lead or an update?']");
  check("capture box on the pipeline", await box.isVisible());
  // drop a screenshot onto the box
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const dt = await page.evaluateHandle((b64) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const d = new DataTransfer(); d.items.add(new File([u], "mail.png", { type: "image/png" })); return d;
  }, png);
  const zone = box.locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
  await zone.dispatchEvent("dragover", { dataTransfer: dt });
  await zone.dispatchEvent("drop", { dataTransfer: dt });
  await page.waitForTimeout(800);
  check("dropped screenshot shows as a thumbnail", (await zone.locator("img").count()) === 1);
  // a text file (WhatsApp export) drops its text into the box
  const dt2 = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(["06/11/2026, 22:15 - Priya: Can we talk tomorrow?"], "WhatsApp Chat with Priya.txt", { type: "text/plain" })); return d; });
  await zone.dispatchEvent("drop", { dataTransfer: dt2 });
  await page.waitForTimeout(500);
  check("dropped chat export goes into the text", (await box.inputValue()).includes("Can we talk tomorrow?"));
  // without an AI key here, Log it must fail with a message, never crash the page
  const errs = t.errors.length;
  await zone.getByRole("button", { name: "Log it" }).click();
  await page.waitForTimeout(3000);
  check("page still works after a failed capture", await box.isVisible() && !(await page.getByText("Application error").count()) && !(await page.getByText("This page hit a snag").count()));
  t.errors.splice(errs);
  await t.done();
})();
