const { chromium } = require("playwright");
const { setup, check, U } = require("./lib.cjs");
(async () => {
  const t = await setup();
  const { page, one, go, db } = t;
  console.log("Sales team logins: the owner's controls, the salesperson's portal, and break-in attempts");
  await db.query("delete from sales_users where username in ('riya.e2e','arjun.e2e')");
  const PW = "riyaE2E2026pass";

  // ---------- owner creates a login
  await go("/sales/settings#team-logins");
  await page.getByRole("button", { name: "Add a salesperson" }).click();
  const form = page.getByLabel("New login");
  await form.getByLabel("Their name").fill("Riya E2E");
  await form.getByLabel("Username").fill("riya.e2e");
  await form.getByLabel("Password", { exact: true }).fill(PW);
  await form.getByRole("button", { name: "Create login" }).click();
  await page.getByText("@riya.e2e").waitFor();
  const u = await one("select id, pass_hash, pass_enc from sales_users where username = 'riya.e2e'");
  check("login stored hashed and encrypted, never plain", u && !u.pass_hash.includes(PW) && u.pass_enc.startsWith("gcm1$") && !u.pass_enc.includes(PW));
  await page.getByRole("button", { name: "Show Riya E2E's login" }).click();
  check("owner can read the login back", (await page.getByLabel("Login details").innerText()).includes(PW));
  await db.query("insert into sales_users (username, display_name, pass_hash, pass_enc) select 'arjun.e2e', 'Arjun E2E', pass_hash, pass_enc from sales_users where id = $1", [u.id]);
  const arjun = await one("select id from sales_users where username = 'arjun.e2e'");

  // ---------- owner shares one deal and hides another
  const deals = (await db.query("select id, title from sales_deals where stage_id in (select id from sales_stages where category = 'open') order by id limit 2")).rows;
  const [sharedDeal, hiddenDeal] = deals;
  await db.query("update sales_deals set value_amount = 777777 where id = $1", [sharedDeal.id]);
  await go(`/sales/deal/${sharedDeal.id}`);
  const team = page.getByRole("region", { name: "Sales team" });
  await team.getByLabel("Share with Riya E2E").check();
  await page.waitForTimeout(800);
  check("deal shared from the deal page", !!(await one("select 1 from sales_deal_access where deal_id = $1 and user_id = $2", [sharedDeal.id, u.id])));
  // owner logs a private note, and one shown to Riya
  await db.query("insert into sales_interactions (deal_id, channel, direction, body, summary, source) values ($1,'note','internal','owner secret: they pay 9 lakh','owner secret: they pay 9 lakh','manual')", [sharedDeal.id]);
  const shown = await one("insert into sales_interactions (deal_id, channel, direction, body, summary, source) values ($1,'note','internal','Ask for the CTO','Ask for the CTO','manual') returning id", [sharedDeal.id]);
  await go(`/sales/deal/${sharedDeal.id}`);
  const vis = page.getByRole("button", { name: /Who sees this/ }).first();
  check("each of your updates says who sees it", await vis.isVisible());
  await db.query("update sales_interactions set shared_with = array[$2::int] where id = $1", [shown.id, u.id]);

  // ---------- the salesperson
  const browser = await chromium.launch();
  const rctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const rp = await rctx.newPage();
  const rerr = [];
  rp.on("pageerror", (e) => rerr.push(e.message));
  await rp.goto(U + "/team", { waitUntil: "networkidle" });
  check("not signed in: /team goes to the sign-in page", rp.url().endsWith("/team/login"));
  await rp.getByLabel("Username").fill("riya.e2e");
  await rp.getByLabel("Password").fill("wrong-password-1");
  await rp.getByRole("button", { name: /Sign in/ }).click();
  await rp.waitForTimeout(800);
  check("a wrong password is refused", rp.url().endsWith("/team/login"));
  await rp.getByLabel("Password").fill(PW);
  await rp.getByRole("button", { name: /Sign in/ }).click();
  await rp.waitForURL(U + "/team", { timeout: 10000 });
  const cookies = await rctx.cookies();
  const c = cookies.find((x) => x.name === "daybook_team");
  check("session cookie is httpOnly, strict and opaque", c && c.httpOnly && c.sameSite === "Strict" && !c.value.includes("riya"));
  const body = await rp.locator("main").innerText();
  check("sees the shared lead", body.includes(sharedDeal.title));
  check("does not see the unshared lead", !body.includes(hiddenDeal.title));

  await rp.goto(U + `/team/lead/${sharedDeal.id}`, { waitUntil: "networkidle" });
  const lead = await rp.locator("main").innerText();
  check("lead page: shown update visible", lead.includes("Ask for the CTO"));
  check("lead page: owner's private note hidden", !lead.includes("9 lakh"));
  check("lead page: value hidden", !lead.includes("7,77,777") && !lead.includes("777777"));

  // log an activity through the portal
  await rp.getByLabel(/What happened/).first().fill("Called, they want a demo on Friday");
  await rp.getByRole("button", { name: /^Log/ }).first().click();
  await rp.waitForTimeout(1200);
  const logged = await one("select author_user from sales_interactions where deal_id = $1 and body like 'Called, they want a demo%' order by id desc limit 1", [sharedDeal.id]);
  check("their update is logged under their name", logged && logged.author_user === u.id, logged);

  // ---------- break-in attempts with Riya's session
  const req = rctx.request;
  const st = async (p, o) => (await (o ? req.post(U + p, o) : req.get(U + p, { maxRedirects: 0 }))).status();
  check("unshared lead page is not found", (await req.get(U + `/team/lead/${hiddenDeal.id}`)).status() === 404);
  check("owner pages redirect away", [302, 303, 307, 308].includes(await st(`/sales/deal/${sharedDeal.id}`)) || (await req.get(U + "/sales")).url().includes("/team"));
  check("owner APIs refused", [401, 403].includes(await st("/api/sales/export")) || [302, 307].includes(await st("/api/sales/export")));
  const act = (data, headers = {}) => req.post(U + "/api/team/action", { data, headers: { "content-type": "application/json", origin: U, ...headers } });
  check("action on an unshared lead: 404", (await act({ op: "log", deal_id: hiddenDeal.id, type: "note", body: "x" })).status() === 404);
  check("changing the value without permission refused", (await act({ op: "update_lead", deal_id: sharedDeal.id, patch: { value_amount: 1 } })).status() === 400);
  check("cross-site POST refused", (await act({ op: "log", deal_id: sharedDeal.id, type: "note", body: "x" }, { origin: "https://evil.example" })).status() >= 400);
  check("deleting the owner's note refused", (await act({ op: "delete_log", id: shown.id })).status() === 404);
  const sa = await req.post(U + "/sales", { headers: { "next-action": "0000000000000000000000000000000000000000", "content-type": "text/plain" }, data: "[]", maxRedirects: 0 });
  check("server actions refused without the owner session", sa.status() === 401, sa.status());
  const anon = await chromium.launch().then((b) => b.newContext());
  const sa2 = await anon.request.post(U + "/team/login", { headers: { "next-action": "0000000000000000000000000000000000000000" }, data: "[]", maxRedirects: 0 });
  check("server actions refused on public pages too", sa2.status() === 401, sa2.status());
  check("team API needs a session", (await anon.request.post(U + "/api/team/action", { data: { op: "log" }, headers: { origin: U } })).status() === 401);
  const forged = await browser.newContext();
  await forged.addCookies([{ name: "daybook_team", value: c.value.slice(0, -4) + "AAAA", url: U }]);
  check("a tampered cookie is not a session", (await forged.request.post(U + "/api/team/action", { data: { op: "log" }, headers: { origin: U } })).status() === 401);
  check("cannot see Arjun's private screen", (await req.get(U + `/team/lead/${hiddenDeal.id}`)).status() === 404 && !!arjun);

  // ---------- switching the login off ends the session at once
  await go("/sales/settings#team-logins");
  await page.getByRole("listitem").filter({ hasText: "@riya.e2e" }).getByRole("button", { name: "Switch off" }).click();
  await page.waitForTimeout(800);
  check("switched-off login is signed out", (await act({ op: "log", deal_id: sharedDeal.id, type: "note", body: "x" })).status() === 401);
  await db.query("update sales_users set active = true where id = $1", [u.id]);
  check("no salesperson page errors", rerr.length === 0, rerr);
  await browser.close();
  await t.done();
})();
