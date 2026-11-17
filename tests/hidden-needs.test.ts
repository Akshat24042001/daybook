// Hidden needs (businesses that never posted but show a buying signal), smart search everywhere, the reach score
// (a decision maker's own contact beats an info@ inbox) and research by default for every deal.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ systems: [] as string[], reply: null as unknown }));
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return { ...real, llmConfigured: () => true, llmJson: vi.fn(async (system: string) => { ai.systems.push(system); return ai.reply; }) };
});
const web = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("@/lib/sales/search", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/search")>();
  return {
    ...real,
    geminiSearchReady: () => false,
    webSearch: vi.fn(async (query: string) => {
      web.queries.push(query);
      return [
        { title: "Business Development Representative at Gulf Gems Trading LLC, Dubai", url: "https://www.linkedin.com/jobs/view/123", snippet: "Gulf Gems Trading LLC is hiring 3 BDRs in Dubai to call jewellery retailers. gulfgems.ae" },
        { title: "Talent Hunters Recruitment: SDR roles in Dubai", url: "https://talenthunters.example/jobs", snippet: "Talent Hunters Recruitment is hiring SDRs for a client" },
      ];
    }),
  };
});

import { one, q } from "@/lib/db";
import { createDeal } from "@/lib/sales/deals";
import { haystack, matchesAll, searchTerms, snippet } from "@/lib/sales/find-match";
import { searchDeals, searchRadar } from "@/lib/sales/find";
import { priority, reachOf, type RankItem } from "@/lib/sales/radar-rank";
import { enrichSweep } from "@/lib/sales/run";
import { groundSignals, huntSignals, pickSignalRun, signalBody, signalQueries, SIGNAL_KINDS } from "@/lib/sales/signals";
import { searchAll } from "@/lib/services/search";

beforeEach(async () => {
  await q("truncate sales_radar_items, sales_jobs, sales_companies, sales_people, sales_deals, sales_interactions restart identity cascade");
  ai.systems = [];
  ai.reply = null;
  web.queries = [];
});

describe("hidden needs: pure parts", () => {
  it("every signal has searches that name the country, the industry and the year where it helps", () => {
    for (const k of SIGNAL_KINDS) {
      const qs = signalQueries(k, "United Arab Emirates", "jewellery", 2026);
      expect(qs.length).toBe(2);
      for (const x of qs) expect(x).toMatch(/jewellery/), expect(x).toMatch(/United Arab Emirates/);
    }
    expect(signalQueries("sales_hiring", "UK", "retail", 2026)[0]).toMatch(/sales development representative/);
  });

  it("each run looks at one country and industry and two different signals, and the runs move across the list", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const r = pickSignalRun(["United States", "United Kingdom", "Canada"], ["retail", "logistics", "real estate"], { country: "Singapore", industry: "travel" }, i);
      expect(r.kinds[0]).not.toBe(r.kinds[1]);
      seen.add(`${r.country}|${r.industry}`);
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  it("keeps only companies the results name, with the evidence page; drops recruiters and invented ones", () => {
    const hits = [
      { title: "BDR at Gulf Gems Trading LLC", url: "https://www.linkedin.com/jobs/view/1", snippet: "Gulf Gems Trading LLC hiring BDRs, gulfgems.ae" },
      { title: "Talent Hunters Recruitment", url: "https://th.example/jobs", snippet: "Talent Hunters Recruitment hiring SDRs" },
    ];
    const out = groundSignals([
      { company: "Gulf Gems Trading LLC", website: "https://gulfgems.ae", signal: "sales_hiring", evidence_url: "https://www.linkedin.com/jobs/view/1", need: "Hiring BDRs means outreach is manual." },
      { company: "Talent Hunters Recruitment", signal: "sales_hiring", evidence_url: "https://th.example/jobs" },
      { company: "Made Up Jewels", signal: "funding", evidence_url: "https://nowhere.example" },
      { company: "Gulf Gems Trading LLC", signal: "not_a_signal" as never },
    ], hits);
    expect(out.map((x) => x.company)).toEqual(["Gulf Gems Trading LLC"]);
    expect(out[0]).toMatchObject({ website: "https://gulfgems.ae", evidence_url: "https://www.linkedin.com/jobs/view/1", signal: "sales_hiring" });
    expect(out[0].offer).toMatch(/AI sales agent/); // filled from the signal when the AI left it out
    const body = signalBody(out[0], "United Arab Emirates");
    expect(body).toMatch(/^\[hidden need: Hiring salespeople\]/);
    expect(body).toMatch(/Nobody posted this/);
    expect(body).toMatch(/Who decides:/);
  });
});

describe("hidden needs: a run", () => {
  it("searches the signals, stores grounded companies as hidden-need leads once, and never a recruiter", async () => {
    ai.reply = { companies: [
      { company: "Gulf Gems Trading LLC", website: "gulfgems.ae", signal: "sales_hiring", evidence_url: "https://www.linkedin.com/jobs/view/123", need: "Three BDRs at once means calls and follow ups are done by hand.", offer: "An AI sales agent", who: "Founder or Head of Sales", opener: "Saw you are hiring three BDRs in Dubai.", city: "Dubai" },
      { company: "Talent Hunters Recruitment", signal: "sales_hiring", evidence_url: "https://talenthunters.example/jobs" },
    ] };
    const r = await huntSignals(60_000, 0);
    expect(web.queries.length).toBe(4);
    expect(ai.systems[0]).toMatch(/have not asked for it/);
    expect(r.added).toBe(1);
    const it = (await one<{ title: string; body: string; lead_kind: string; url: string; poster: { name: string } }>("select title, body, lead_kind, url, poster from sales_radar_items"))!;
    expect(it.lead_kind).toBe("signal");
    expect(it.title).toMatch(/^Gulf Gems Trading LLC, Dubai/);
    expect(it.url).toBe("https://gulfgems.ae");
    expect(it.body).toMatch(/linkedin\.com\/jobs\/view\/123/);
    expect(it.poster.name).toBe("Gulf Gems Trading LLC");
    // the next run does not add the same company again
    expect((await huntSignals(60_000, 1)).added).toBe(0);
  });
});

describe("smart search", () => {
  it("every word must appear, in any field; quoted phrases stay whole; numbers match on their digits", () => {
    expect(searchTerms('dubai "gold chain" x')).toEqual(["dubai", "gold chain"]);
    const deal = { title: "Website", company_name: "Gulf Gems", notes: { said: "wants WhatsApp bot" }, phones: ["+971 50 123 4567"] };
    expect(matchesAll(haystack(deal), searchTerms("gulf whatsapp"))).toBe(true);
    expect(matchesAll(haystack(deal), searchTerms("gulf instagram"))).toBe(false);
    expect(matchesAll(haystack(deal), searchTerms("501234567"))).toBe(true);
    expect(snippet("A long text where the word WhatsApp shows up", ["whatsapp"])).toMatch(/WhatsApp/);
  });

  it("finds a deal by a word that is only in its chat, and a radar lead by a word only in its research", async () => {
    const id = await createDeal({ title: "Store app", requirements: "an app" });
    await q("insert into sales_interactions (deal_id, channel, direction, body) values ($1, 'whatsapp', 'in', 'Can it read our Tally invoices?')", [id]);
    expect((await searchDeals("tally invoices")).map((d) => d.id)).toEqual([id]);
    expect(await searchDeals("tally shopify")).toEqual([]);
    const lead = (await one<{ id: number }>("insert into sales_radar_items (url, url_hash, title, body, identity) values ('u', 'h', 'Need a bot', 'x', $1) returning id",
      [JSON.stringify({ status: "found", person: "Farah Qureshi", emails: ["farah@gulfgems.ae"] })]))!.id;
    expect((await searchRadar("farah")).map((l) => l.id)).toEqual([lead]);
    const all = await searchAll("tally");
    expect(all.some((h) => h.kind === "deal" && h.href === `/sales/deal/${id}`)).toBe(true);
    expect((await searchAll("farah")).some((h) => h.kind === "lead" && h.href === `/sales/radar?lead=${lead}`)).toBe(true);
  });
});

describe("reach score", () => {
  const base: RankItem = { id: 1, title: "Need a booking bot", body: "", url: null, score: 70, posted_at: null, found_at: new Date().toISOString(), fit: null };
  it("a decision maker's own contact ranks above a named person, which ranks above a general inbox", () => {
    const dm: RankItem = { ...base, prep: { stage: "ready", pack: { decision_maker: { name: "Farah Qureshi", title: "Founder", email: "farah@gulfgems.ae", phone: null, linkedin: null } } } };
    const generic: RankItem = { ...base, identity: { status: "found", emails: ["info@gulfgems.ae"], phones: ["+971 4 000 0000"] } };
    const person: RankItem = { ...base, identity: { status: "found", emails: ["omar@gulfgems.ae"], phones: [] } };
    expect(reachOf(dm).level).toBe("decision_maker");
    expect(reachOf(person).level).toBe("person");
    expect(reachOf(generic)).toMatchObject({ level: "generic", label: "Only a general inbox or front desk number" });
    expect(reachOf(base).level).toBe("none");
    const now = Date.now();
    expect(priority(dm, now).value).toBeGreaterThan(priority(person, now).value);
    expect(priority(person, now).value).toBeGreaterThan(priority(generic, now).value);
    expect(priority(generic, now).value).toBeGreaterThan(priority(base, now).value);
    expect(priority(dm, now).reasons).toContain("You can reach the decision maker directly");
  });

  it("a decision maker known only by an info@ address is not counted as reachable", () => {
    const it2: RankItem = { ...base, prep: { stage: "ready", pack: { decision_maker: { name: "A", email: "info@x.com", phone: null, linkedin: null } } } };
    expect(reachOf(it2).level).not.toBe("decision_maker");
  });
});

describe("research by default", () => {
  it("queues research for open deals whose business or contact was never researched, once", async () => {
    const co = (await one<{ id: number }>("insert into sales_companies (name) values ('Gulf Gems') returning id"))!.id;
    const pe = (await one<{ id: number }>("insert into sales_people (full_name, company_id) values ('Farah', $1) returning id", [co]))!.id;
    await createDeal({ title: "Bot", company_id: co, person_id: pe });
    await q("delete from sales_jobs");
    expect(await enrichSweep()).toBe(2);
    expect((await q("select kind from sales_jobs order by kind")).map((r) => (r as { kind: string }).kind)).toEqual(["enrich_company", "enrich_person"]);
    expect(await enrichSweep()).toBe(0);
  });
});
