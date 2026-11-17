// A task with several people: add them on the task page, see them all on Today.
const { setup, check } = require("./lib.cjs");

(async () => {
  const { page, one, go, done } = await setup();
  const tag = Date.now().toString(36);
  const t = await one("insert into tasks (title, type) values ($1, 'follow_up') returning id", [`E2E people ${tag}`]);
  await go(`/task/${t.id}`);
  const box = page.locator('input[aria-label="Person"]:visible').first();
  await box.fill(`Krina ${tag}`);
  await box.press("Enter");
  await page.locator('input[aria-label="Add another person"]:visible').first().fill(`Ravi ${tag}`);
  await page.locator('input[aria-label="Add another person"]:visible').first().press("Enter");
  check("both show as chips", (await page.getByRole("list", { name: "People" }).innerText()).includes(`Krina ${tag}`) && (await page.getByRole("list", { name: "People" }).innerText()).includes(`Ravi ${tag}`));
  await page.getByRole("button", { name: /^Save/ }).first().click();
  await page.waitForTimeout(1500);
  const rows = await one("select string_agg(p.name, ', ' order by tp.sort) as n from task_people tp join people p on p.id = tp.person_id where tp.task_id = $1", [t.id]);
  check("both saved, in order", rows.n === `Krina ${tag}, Ravi ${tag}`, rows);

  // on Today
  const today = await one("select to_char((now() at time zone 'Asia/Kolkata') - interval '4 hours', 'YYYY-MM-DD') as d");
  await one("insert into day_entries (task_id, date, source) values ($1, $2, 'planned') on conflict do nothing returning id", [t.id, today.d]).catch(() => null);
  await go("/today");
  const text = await page.locator("main").innerText();
  check("Today shows everyone on the task", text.includes(`Krina ${tag}, Ravi ${tag}`), text.slice(0, 200));
  await done();
})();
