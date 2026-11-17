// The opportunity audit is built on what the lead told you, never on a namesake's research, and goes stale (and is
// rebuilt) when they tell you something new.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ system: "", user: "" }));
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real,
    llmConfigured: () => true,
    llmJson: vi.fn(async (system: string, user: string) => {
      ai.system = system;
      ai.user = user;
      return { summary: "They want WhatsApp booking for their salon.", opportunities: [{ title: "WhatsApp booking", problem: "manual booking", fix: "agent", impact: "~10 hrs/week", effort: "weeks" }], first_project: "WhatsApp booking agent" };
    }),
  };
});
vi.mock("@/lib/sales/search", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/search")>();
  return { ...real, geminiSearchReady: () => false, webSearch: vi.fn(async () => []), fetchPage: vi.fn(async () => null) };
});

import { one, q } from "@/lib/db";
import { auditCompany } from "@/lib/sales/enrich";
import { auditStale, leadSaid } from "@/lib/sales/lead-said";
import { createDeal, logActivity, updateDeal } from "@/lib/sales/deals";
import { dealAutopilot } from "@/lib/sales/autopilot";

beforeEach(async () => {
  await q("truncate sales_companies, sales_deals, sales_interactions, sales_jobs, sales_people restart identity cascade");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

async function lead() {
  const co = (await one<{ id: number }>("insert into sales_companies (name, enrichment) values ('Bliss', $1) returning id",
    [JSON.stringify({ identity_match: { v: "not found" }, summary: { v: "Bliss Club, activewear brand in Bengaluru with 300 staff" }, founders: { v: "Mrigya Jain" } })]))!.id;
  const id = await createDeal({ title: "Bliss", company_id: co, source: "outbound" });
  await updateDeal(id, { city: "Dubai", requirements: "WhatsApp booking for the salon; staff forget to confirm appointments" });
  return { co, id };
}

describe("the opportunity audit", () => {
  it("leads with what they told you and leaves out research not confirmed to be them", async () => {
    const { co } = await lead();
    const a = (await auditCompany(co))!;
    expect(ai.system).toMatch(/WHAT THEY TOLD US comes first/);
    expect(ai.user).toContain("What they need: WhatsApp booking for the salon");
    expect(ai.user).toContain("Dubai");
    expect(ai.user).not.toMatch(/Bengaluru|Mrigya|activewear/);
    expect(ai.user).toMatch(/RESEARCH: not confirmed/);
    expect(a.based_on).toMatchObject({ said: true, research: false, website: null });
    expect((await one<{ audited_at: string }>("select audited_at from sales_companies where id = $1", [co]))!.audited_at).toBeTruthy();
  });

  it("goes stale when they tell you something new, and the next log rebuilds it", async () => {
    const { co, id } = await lead();
    expect(await auditStale(co)).toBe(true); // never built
    await auditCompany(co);
    expect(await auditStale(co)).toBe(false);
    // the summary being rewritten is not news
    await updateDeal(id, { summary: "Talking about a booking bot." });
    expect(await auditStale(co)).toBe(false);
    // their message is
    await logActivity(id, { type: "whatsapp", direction: "in", body: "We also want Instagram DMs answered automatically" });
    expect((await leadSaid(co)).text).toContain("Instagram DMs");
    expect(await auditStale(co)).toBe(true);
    await dealAutopilot(id);
    expect(await one("select 1 from sales_jobs where kind = 'audit_website' and payload->>'id' = $1", [String(co)])).toBeTruthy();
  });
});
