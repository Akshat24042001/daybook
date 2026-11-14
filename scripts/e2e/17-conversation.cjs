const zlib = require("node:zlib");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setup, check } = require("./lib.cjs");

/** A plain white PNG of the given size (a long scrolling screenshot stand-in). */
function png(w, h) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 255); for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

(async () => {
  const t = await setup();
  const { page, one, go, db } = t;
  console.log("Where we are: summary, timeline, quick actions; long screenshots; a failed read can be retried");
  const deal = await one("select id, title from sales_deals where stage_id in (select id from sales_stages where category = 'open') order by id limit 1");
  await db.query("update sales_deals set summary = $2, next_action = null, next_action_at = null, conversation = $3 where id = $1", [deal.id,
    "Wants a WhatsApp booking bot for 3 branches. Asked the price. Proposal promised by Friday.",
    JSON.stringify({ quick_actions: [
      { kind: "send", label: "Send the proposal", detail: "3 branches, booking bot", due: "2026-11-20", stage: null },
      { kind: "promise", label: "Share two case studies", detail: null, due: "2026-11-18", stage: null },
      { kind: "call", label: "Call to walk through pricing", detail: null, due: null, stage: null },
    ], reply_draft: "Hi Ravi, for 3 branches it is around 2 lakh. Full proposal by Friday.", at: new Date().toISOString() })]);
  await db.query("insert into sales_interactions (deal_id, channel, direction, body, summary, source, occurred_at) values ($1,'whatsapp','in','What would it cost for 3 branches?','Asked the price for 3 branches','manual', now())", [deal.id]);

  await go(`/sales/deal/${deal.id}`);
  const card = page.getByRole("region", { name: "Conversation" });
  check("summary shown", (await card.innerText()).includes("Asked the price"));
  check("timeline shown", (await card.getByRole("list", { name: "Conversation timeline" }).innerText()).includes("Asked the price for 3 branches"));
  check("three quick actions", (await card.getByRole("list", { name: "Quick actions" }).getByRole("listitem").count()) === 3);
  check("reply you could send", (await card.getByLabel("Suggested reply").innerText()).includes("around 2 lakh"));
  check("no long dash on the card", !/[\u2012-\u2015]/.test(await card.innerText()));

  await card.getByRole("button", { name: "Do it: Send the proposal" }).click();
  await page.waitForTimeout(1200);
  const d = await one("select next_action, next_action_at, conversation from sales_deals where id = $1", [deal.id]);
  check("one click sets the next step with its date", d.next_action === "Send the proposal: 3 branches, booking bot" && new Date(d.next_action_at).toISOString().startsWith("2026-11-20"), d);
  await card.getByRole("button", { name: "Do it: Share two case studies" }).click();
  await page.waitForTimeout(1200);
  check("a promise goes on the promise list", !!(await one("select 1 from sales_commitments where deal_id = $1 and text = 'Share two case studies' and owner = 'me'", [deal.id])));
  await card.getByRole("button", { name: "Not now: Call to walk through pricing" }).click();
  await page.waitForTimeout(1200);
  check("done and dismissed actions leave the list", (await card.getByRole("list", { name: "Quick actions" }).count()) === 0);

  // a long scrolling screenshot is cut into readable parts
  const file = path.join(os.tmpdir(), "long-chat.png");
  fs.writeFileSync(file, png(1080, 5200));
  await page.locator('input[type="file"][accept^="image/"]').first().setInputFiles(file);
  await page.waitForTimeout(1500);
  const thumbs = await page.locator('img[src^="data:image/jpeg"]').count();
  check("long screenshot cut into parts", thumbs >= 3 && thumbs <= 4, thumbs);

  // no AI key on this test server: the capture fails with a message, is kept, and offers a retry
  const before = (await one("select count(*)::int n from sales_captures")).n;
  t.errors.length = 0;
  await page.getByRole("button", { name: "Log it" }).click();
  const alert = page.getByRole("alert", { name: "Could not file it" });
  await alert.waitFor({ timeout: 20000 });
  check("failed read says why", /AI key|GEMINI_API_KEY/i.test(await alert.innerText()));
  check("and offers Try again", await alert.getByRole("button", { name: "Try again" }).isVisible());
  const cap = await one("select status, greatest(jsonb_array_length(coalesce(images, '[]'::jsonb)), coalesce(cardinality(image_paths), 0)) n from sales_captures order by id desc limit 1");
  check("the capture and its screenshots are kept", (await one("select count(*)::int n from sales_captures")).n === before + 1 && cap.status === "failed" && cap.n >= 3, cap);
  await t.done();
})();
