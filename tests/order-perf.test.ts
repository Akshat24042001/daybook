import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sales/notify", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/notify")>();
  return { ...real, push: vi.fn(async () => 1) };
});
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return { ...real, llmConfigured: () => false, llmJson: vi.fn(async () => { throw new Error("no AI"); }), llm: vi.fn(async () => { throw new Error("no AI"); }) };
});

import { one, q } from "@/lib/db";
import { createDeal } from "@/lib/sales/deals";
import { refreshMoves } from "@/lib/sales/moves";
import { resetManualOrder, setManualOrder } from "@/lib/sales/order";
import { refreshPriorities } from "@/lib/sales/priority";
import { moveDeal } from "@/lib/sales/stages";
import { isStaleClientError } from "@/lib/stale-client";

async function resetSales() {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_docs, sales_quote_revisions, sales_doc_views,
           sales_payments, sales_radar_items, sales_jobs, sales_tg_prompts, sales_calls, sales_focus, sales_blocklist, sales_offers,
           sales_proofs, sales_objections, sales_deal_objections, sales_custom_fields, sales_deal_items, sales_team restart identity cascade`);
  await q("update sales_settings set config = '{}'::jsonb");
}
beforeEach(resetSales);
const stage = async (role: string) => (await one<{ id: number }>("select id from sales_stages where role = $1", [role]))!.id;
const rank = async (id: number) => (await one<{ r: number | null }>("select manual_rank as r from sales_deals where id = $1", [id]))!.r;

describe("your own order on the board", () => {
  it("saves the top of a column in your order, ignores other stages, and resets", async () => {
    const a = await createDeal({ title: "A" });
    const b = await createDeal({ title: "B" });
    const c = await createDeal({ title: "C" });
    const st = (await one<{ stage_id: number }>("select stage_id from sales_deals where id = $1", [a]))!.stage_id;
    await setManualOrder(st, [b, a]);
    expect(await rank(b)).toBe(1);
    expect(await rank(a)).toBe(2);
    expect(await rank(c)).toBeNull();
    // an id from another stage is ignored
    await q("update sales_deals set stage_id = (select id from sales_stages where id <> $1 and category = 'open' order by sort limit 1) where id = $2", [st, c]);
    await setManualOrder(st, [c, b]);
    expect(await rank(c)).toBeNull();
    expect(await rank(b)).toBe(2);
    expect(await resetManualOrder(st)).toBe(2);
    expect(await rank(a)).toBeNull();
  });

  it("a deal that changes stage goes back to automatic order", async () => {
    const a = await createDeal({ title: "Mover" });
    const st = (await one<{ stage_id: number }>("select stage_id from sales_deals where id = $1", [a]))!.stage_id;
    await setManualOrder(st, [a]);
    expect(await rank(a)).toBe(1);
    await moveDeal(a, await stage("contacted"), { force: true });
    expect(await rank(a)).toBeNull();
  });
});

describe("batched refreshes", () => {
  it("priorities: one pass scores every deal and skips the ones that did not change", async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await createDeal({ title: `D${i}`, value_amount: 1000 * (i + 1), currency: "INR" }));
    await refreshPriorities();
    const rows = await q<{ priority: number; priority_why: string[] }>("select priority, priority_why from sales_deals order by id");
    expect(rows.every((r) => r.priority > 0 && Array.isArray(r.priority_why))).toBe(true);
    const before = await q<{ xmin: string }>("select xmin::text from sales_deals order by id");
    await refreshPriorities();
    const after = await q<{ xmin: string }>("select xmin::text from sales_deals order by id");
    expect(after).toEqual(before);
  });

  it("moves: a second refresh with nothing new rewrites no move", async () => {
    for (let i = 0; i < 3; i++) await createDeal({ title: `M${i}` });
    await refreshMoves();
    const n = (await one<{ n: number }>("select count(*)::int as n from sales_moves where status = 'open'"))!.n;
    expect(n).toBeGreaterThan(0);
    const before = await q<{ xmin: string }>("select xmin::text from sales_moves order by id");
    await refreshMoves();
    const after = await q<{ xmin: string }>("select xmin::text from sales_moves order by id");
    expect(after).toEqual(before);
  });
});

describe("stale tab after a deploy", () => {
  it("recognises the errors a reload fixes, and nothing else", () => {
    expect(isStaleClientError(Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" }))).toBe(true);
    expect(isStaleClientError(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.'))).toBe(true);
    expect(isStaleClientError(new Error("An unexpected response was received from the server."))).toBe(true);
    expect(isStaleClientError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleClientError(null)).toBe(false);
  });
});
