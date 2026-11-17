// Priorities: every open task on a 2x2 board. Real mouse drags between boxes and within a box, the Move menu, Today,
// the Eisenhower board with urgency read from dates, Drop all with Undo, and the phone layout.
const { setup, check, choose } = require("./lib.cjs");

(async () => {
  const { page, one, go, done } = await setup();
  // earlier runs' cards would crowd the boxes: close them first
  await one("update tasks set state = 'dropped', closed_at = now() where title like 'E2E pri %' and state = 'active'");
  const tag = Date.now().toString(36);
  const T = (s) => `E2E pri ${s} ${tag}`;
  const mk = async (s, extra = "") => (await one(`insert into tasks (title${extra ? ", " + extra.split("=")[0] : ""}) values ($1${extra ? ", $2" : ""}) returning id`, extra ? [T(s), extra.split("=")[1]] : [T(s)])).id;
  const proposal = await mk("send proposal");
  const website = await mk("rebuild website");
  const inbox = await mk("clean inbox");
  const photos = await mk("sort old photos");
  const renew = await mk("renew domain", "due_date=" + new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const row = (id) => one("select value_level, effort_level, importance, urgency, value_rank, state from tasks where id = $1", [id]);

  const drag = async (fromSel, toSel) => {
    const a = await page.locator(fromSel).boundingBox();
    const b = await page.locator(toSel).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
  };
  const grip = (id) => `[data-task="${id}"] button[aria-label^="Drag"]`;

  await go("/priorities");
  const tray = page.getByRole("region", { name: "To sort" });
  check("all open tasks start in To sort", (await tray.innerText()).includes(T("send proposal")) && (await tray.innerText()).includes(T("renew domain")));
  check("four boxes with their names", (await Promise.all(["Quick wins", "Big bets", "Fill-ins", "Time sinks"].map((n) => page.getByRole("region", { name: n }).isVisible()))).every(Boolean));

  // ---- drag from the tray into Quick wins
  await drag(grip(proposal), '[data-box="quick"]');
  check("dragged into Quick wins = high value, low effort", JSON.stringify(await row(proposal)).includes('"value_level":"high","effort_level":"low"'), await row(proposal));
  await drag(grip(inbox), '[data-box="quick"]');
  check("second task also in Quick wins", (await row(inbox)).value_level === "high");
  // ---- reorder within the box: drop inbox on proposal = above it
  await drag(grip(inbox), `[data-task="${proposal}"]`);
  const r1 = await row(inbox), r2 = await row(proposal);
  check("reordered inside the box", r1.value_rank !== null && r2.value_rank !== null && r1.value_rank < r2.value_rank, [r1, r2]);
  await go("/priorities");
  const quickText = await page.getByRole("region", { name: "Quick wins" }).innerText();
  check("order kept after reload", quickText.indexOf(T("clean inbox")) < quickText.indexOf(T("send proposal")));

  // ---- the Move menu (phones, keyboards)
  await choose(page, page.getByLabel(`Move ${T("rebuild website")}`), /^Big bets$/);
  await page.waitForTimeout(1200);
  check("Move menu puts it in Big bets", (await row(website)).effort_level === "high" && (await row(website)).value_level === "high");
  await choose(page, page.getByLabel(`Move ${T("sort old photos")}`), /^Time sinks$/);
  await page.waitForTimeout(1200);

  // ---- Start here + Today
  check("Start here names the top quick win", (await page.getByRole("region", { name: "Start here" }).innerText()).includes(T("clean inbox")));
  await page.getByRole("button", { name: `Put ${T("clean inbox")} on Today` }).click();
  await page.waitForTimeout(1500);
  check("put on Today", !!(await one("select 1 from day_entries where task_id = $1", [inbox])));

  // ---- History names the move
  await go("/history");
  check("History says where it went", (await page.locator("main").innerText()).includes(`Moved “${T("send proposal")}” to Quick wins`));

  // ---- Eisenhower board: urgency read from the due date
  await go("/priorities?board=eisen");
  check("Eisenhower boxes", (await Promise.all(["Do now", "Schedule", "Delegate", "Drop"].map((n) => page.getByRole("region", { name: n }).isVisible()))).every(Boolean));
  check("boards are independent: proposal still to sort here", (await page.getByRole("region", { name: "To sort" }).innerText()).includes(T("send proposal")));
  await one("update tasks set importance = 'high' where id = $1", [renew]);
  await go("/priorities?board=eisen");
  const doNow = await page.getByRole("region", { name: "Do now" }).innerText();
  check("important + due tomorrow lands in Do now, marked from date", doNow.includes(T("renew domain")) && /from date/.test(doNow), doNow.slice(0, 200));
  await drag(grip(proposal), '[data-box="schedule"]');
  check("dragged into Schedule = important, not urgent", JSON.stringify(await row(proposal)).includes('"importance":"high","urgency":"low"'), await row(proposal));

  // ---- Drop all in Time sinks, then Undo
  await go("/priorities");
  await page.getByRole("region", { name: "Time sinks" }).getByRole("button", { name: /Drop all/ }).click();
  await page.waitForTimeout(1500);
  check("Drop all closes them as dropped", (await row(photos)).state === "dropped");
  await go("/history");
  await page.locator("li", { hasText: "Dropped" }).first().getByRole("button", { name: "Undo" }).click().catch(() => {});
  await page.waitForTimeout(1500);
  check("Undo brings them back", (await row(photos)).state === "active", await row(photos));

  // ---- phone
  await page.setViewportSize({ width: 390, height: 844 });
  await go("/priorities");
  check("fits a phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: "/tmp/e2e-logs/priorities-phone.png", fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go("/priorities");
  await page.screenshot({ path: "/tmp/e2e-logs/priorities-desktop.png" });
  await done();
})();
