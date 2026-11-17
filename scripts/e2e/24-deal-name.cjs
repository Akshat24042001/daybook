// A deal gets the name you give it, and can be renamed right from its title.
const { setup, check } = require("./lib.cjs");

(async () => {
  const { page, one, go, done } = await setup();
  const tag = Date.now().toString(36);
  await go("/sales/pipeline");
  await page.getByRole("button", { name: "New deal" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Deal name").fill(`Namlink ${tag}`);
  await sheet.getByLabel("Person").fill(`Krina Mehta ${tag}`);
  await sheet.getByLabel("What they need").fill("Working on Namlink with Krina");
  await sheet.getByRole("button", { name: /^(Add|Save|Create)/ }).last().click();
  await page.waitForURL(/\/sales\/deal\/\d+/, { timeout: 15000 });
  const d = await one("select id, title from sales_deals where title = $1", [`Namlink ${tag}`]);
  check("the deal takes the name you typed", !!d, d);
  check("the page shows it", (await page.locator("h1").first().innerText()).includes(`Namlink ${tag}`));

  await page.getByRole("button", { name: "Rename this deal" }).click();
  await page.getByLabel("Deal name").first().fill(`Krina Mehta: Namlink ${tag}`);
  await page.getByRole("button", { name: "Save" }).first().click();
  await page.waitForTimeout(1500);
  check("renamed from the pencil", (await one("select title from sales_deals where id = $1", [d.id])).title === `Krina Mehta: Namlink ${tag}`);
  check("the new name shows", (await page.locator("h1").first().innerText()).includes(`Krina Mehta: Namlink ${tag}`));
  await done();
})();
