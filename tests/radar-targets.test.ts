// Targets and trips: one line in, a checked target out; a trip runs only until its last day, finds local businesses
// (only ones a search result names), scores leads against the place, asks to meet on two concrete days, and meetings
// booked from its leads fill the trip plan.
import { beforeEach, describe, expect, it, vi } from "vitest";

const seen: { system: string; user: string }[] = [];
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real, llmConfigured: () => true,
    llmJson: vi.fn(async (system: string, user: string) => {
      seen.push({ system, user: typeof user === "string" ? user : "" });
      if (/turn one line/i.test(system)) {
        return { name: "Udaipur trip", kind: "trip", cities: ["Udaipur"], countries: ["India"], industries: ["Hotels", "Wedding planners"], brief: "Hotels and wedding planners in Udaipur.", trip_from: "2026-11-29", trip_to: "2026-12-02", meet: true, prospects: true };
      }
      if (/plan web searches/i.test(system)) return { queries: ["Udaipur hotel looking for website developer"] };
      if (/From the search results ONLY/.test(system)) {
        return { businesses: [
          { company: "Lake Pichola Haveli", website: "lakepicholahaveli.com", evidence_url: "https://www.justdial.com/Udaipur/hotels", why: "Guests book on WhatsApp; a booking agent answers at night.", industry: "Hotels" },
          { company: "Invented Palace Resort", website: "invented.com", why: "made up" },
          { company: "Mewar Weddings", website: "justdial.com", why: "Enquiries from many sites" },
        ] };
      }
      if (/qualify sales leads/i.test(system)) return [{ i: 1, score: 72, buyer: "signal", why: "Independent hotel", need: "Answer bookings", angle: "Night replies" }];
      return {};
    }),
  };
});
vi.mock("@/lib/sales/search", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/search")>();
  return {
    ...real, geminiSearchReady: () => false, fetchPage: vi.fn(async () => null),
    fetchFeed: vi.fn(async () => [{ title: "New boutique hotel opens near Fateh Sagar, Udaipur", url: "https://news.example/udaipur-hotel", body: "The 20-room hotel opens this month.", date: new Date().toISOString(), author: null }]),
    webSearch: vi.fn(async (query: string) => (/in Udaipur|best Hotels Udaipur|Udaipur Hotels new/i.test(query)
      ? [
        { title: "Top hotels in Udaipur: Lake Pichola Haveli, Mewar Weddings", url: "https://www.justdial.com/Udaipur/hotels", snippet: "Lake Pichola Haveli (lakepicholahaveli.com) near City Palace. Mewar Weddings planners." },
        { title: "Lake Pichola Haveli", url: "https://lakepicholahaveli.com", snippet: "Heritage hotel in Udaipur" },
      ]
      : [{ title: "Udaipur cafe needs Instagram help", url: "https://reddit.com/r/udaipur/1", snippet: "Looking for someone in Udaipur to run our page." }, { title: "Crypto job Udaipur", url: "https://x.example/crypto", snippet: "crypto" }])),
  };
});

import { one, q } from "@/lib/db";
import { runHunt, saveHunt, scheduleHunts, validateHunt } from "@/lib/sales/hunts";
import { qualifyPending } from "@/lib/sales/radar";
import { bookLeadMeeting, endFinishedTargets, groundProspects, isExcluded, meetingOptions, parseDay, parseTarget, parseTargetLine, tripDraftLines, tripFor, tripMeetings, tripPhase } from "@/lib/sales/targets";
import { addDays } from "@/lib/time";

const today = new Date().toISOString().slice(0, 10);

describe("trips in words", () => {
  it("knows where a trip stands", () => {
    const t = { kind: "trip" as const, trip_from: "2026-11-29", trip_to: "2026-12-02" };
    expect(tripPhase(t, "2026-11-14")).toEqual({ phase: "upcoming", label: "Trip in 15 days", days: 15 });
    expect(tripPhase(t, "2026-11-28").label).toBe("Trip tomorrow");
    expect(tripPhase(t, "2026-11-30").phase).toBe("visiting");
    expect(tripPhase(t, "2026-12-03").phase).toBe("over");
    expect(tripPhase({ kind: "standing", trip_from: null, trip_to: null }, "2026-11-14").phase).toBe("none");
  });

  it("offers two concrete times on working days, skipping the arrival day and Sundays", () => {
    // 29 Nov 2026 is a Sunday
    expect(meetingOptions("2026-11-29", "2026-12-02", "2026-11-14")).toEqual(["Tue 1 Dec around 11:00", "Wed 2 Dec around 16:00"]);
    expect(meetingOptions("2026-11-30", "2026-11-30", "2026-11-14")).toEqual(["Mon 30 Nov morning", "Mon 30 Nov afternoon"]);
    // during the trip, only days still ahead
    expect(meetingOptions("2026-11-29", "2026-12-02", "2026-12-01")).toEqual(["Wed 2 Dec morning", "Wed 2 Dec afternoon"]);
    expect(meetingOptions("2026-11-29", "2026-12-02", "2026-12-05")).toEqual([]);
  });

  it("the draft gets the visit and the two options, only when meeting is on", () => {
    const t = { hunt_id: 1, name: "Udaipur trip", city: "Udaipur", trip_from: "2026-11-29", trip_to: "2026-12-02", meet: true };
    const lines = tripDraftLines(t, "2026-11-14", "Akshat");
    expect(lines).toContain("Akshat will be in Udaipur 29 Nov to 2 Dec");
    expect(lines).toContain("Tue 1 Dec around 11:00 or Wed 2 Dec around 16:00");
    expect(tripDraftLines({ ...t, meet: false }, "2026-11-14", "Akshat")).toBe("");
  });
});

describe("one line into a target", () => {
  it("reads dates in the usual ways", () => {
    expect(parseDay("29 Nov", "2026-11-14")).toBe("2026-11-29");
    expect(parseDay("Nov 29th", "2026-11-14")).toBe("2026-11-29");
    expect(parseDay("2 Jan", "2026-11-14")).toBe("2027-01-02");
    expect(parseDay("2026-12-02", "2026-11-14")).toBe("2026-12-02");
    expect(parseDay("02/12", "2026-11-14")).toBe("2026-12-02");
    expect(parseDay("someday", "2026-11-14")).toBeNull();
  });

  it("without AI: the city, the dates and that it is a trip", () => {
    const a = parseTargetLine("I'm traveling to Udaipur from 29 Nov to 2 Dec, want hotels", "2026-11-14");
    expect(a).toMatchObject({ kind: "trip", cities: ["Udaipur"], trip_from: "2026-11-29", trip_to: "2026-12-02", meet: true, prospects: true, name: "Udaipur trip" });
    const b = parseTargetLine("Going to Jaipur in 15 days for 4 days", "2026-11-14");
    expect(b).toMatchObject({ kind: "trip", cities: ["Jaipur"], trip_from: "2026-11-29", trip_to: "2026-12-02" });
    const c = parseTargetLine("Real estate brokers in Dubai", "2026-11-14");
    expect(c).toMatchObject({ kind: "standing", cities: ["Dubai"], meet: false });
  });

  it("with AI: a full target to check, which saves as a trip", async () => {
    const t = await parseTarget("I'm in Udaipur 29 Nov to 2 Dec, hotels and wedding planners");
    expect(t).toMatchObject({ by: "ai", kind: "trip", cities: ["Udaipur"], countries: ["India"], trip_from: "2026-11-29", trip_to: "2026-12-02", meet: true, prospects: true });
  });

  it("checks a trip before saving it", () => {
    expect(() => validateHunt({ name: "x", brief: "y", kind: "trip", cities: [], trip_from: "2026-11-29", trip_to: "2026-12-02" })).toThrow(/which city/);
    expect(() => validateHunt({ name: "x", brief: "y", kind: "trip", cities: ["Udaipur"], trip_from: "2026-11-29" })).toThrow(/first and last day/);
    expect(() => validateHunt({ name: "x", brief: "y", kind: "trip", cities: ["Udaipur"], trip_from: "2026-12-02", trip_to: "2026-11-29" })).toThrow(/end on or after/);
    const ok = validateHunt({ name: "x", brief: "y", kind: "trip", cities: ["Udaipur"], trip_from: "2026-11-29", trip_to: "2026-12-02", prospects: true });
    expect(ok).toMatchObject({ kind: "trip", ends_on: "2026-12-02", meet: true, prospects: true });
    // finding local businesses needs a place
    expect(validateHunt({ name: "x", brief: "y", prospects: true }).prospects).toBe(false);
  });
});

describe("local businesses, never invented", () => {
  const hits = [
    { title: "Top hotels in Udaipur", url: "https://www.justdial.com/Udaipur/hotels", snippet: "Lake Pichola Haveli (lakepicholahaveli.com). Mewar Weddings." },
  ];
  it("keeps only names the results print, websites only when printed, never a directory as a website", () => {
    const out = groundProspects([
      { company: "Lake Pichola Haveli", website: "https://www.lakepicholahaveli.com/rooms", why: "x" },
      { company: "Invented Palace", website: "invented.com" },
      { company: "Mewar Weddings", website: "justdial.com" },
      { company: "lake pichola haveli" },
    ], hits);
    expect(out.map((p) => [p.company, p.website, p.evidence_url])).toEqual([
      ["Lake Pichola Haveli", "https://lakepicholahaveli.com", "https://www.justdial.com/Udaipur/hotels"],
      ["Mewar Weddings", null, "https://www.justdial.com/Udaipur/hotels"],
    ]);
    expect(groundProspects([{ company: "Mewar Weddings" }], hits, ["Mewar Weddings"])).toEqual([]);
    expect(isExcluded(["crypto", "internship"], "A CRYPTO job")).toBe(true);
    expect(isExcluded(["crypto"], "Hotel booking bot")).toBe(false);
    expect(isExcluded(["app"], "A happy client")).toBe(false);
    expect(isExcluded(["mobile app"], "Need a Mobile-App built")).toBe(true);
  });
});

describe("a trip from start to finish", () => {
  beforeEach(async () => {
    seen.length = 0;
    await q("truncate sales_hunts, sales_radar_items, sales_meetings, sales_moves, sales_deals, sales_people, sales_companies, sales_jobs restart identity cascade");
  });

  const addTrip = (o: Record<string, unknown> = {}) => saveHunt({
    name: "Udaipur trip", kind: "trip", brief: "Hotels and wedding planners in Udaipur", cities: ["Udaipur"], countries: ["India"], industries: ["Hotels"],
    trip_from: addDays(today, 15), trip_to: addDays(today, 18), prospects: true, sweep_sources: false, exclude: ["crypto"],
    schedule: "interval", every_hours: 8, window_from: 0, window_to: 24, ...o,
  });

  it("a run finds posts, local news and grounded local businesses, and skips what you excluded", async () => {
    const id = await addTrip();
    await runHunt(id, "manual", 45_000);
    const items = await q<{ title: string; lead_kind: string; url: string }>("select title, lead_kind, url from sales_radar_items where hunt_id = $1 order by id", [id]);
    const titles = items.map((i) => i.title);
    expect(titles).toContain("Udaipur cafe needs Instagram help");
    expect(titles.some((t) => /crypto/i.test(t))).toBe(false);
    expect(items.find((i) => i.lead_kind === "news")?.title).toMatch(/boutique hotel/);
    const prospects = items.filter((i) => i.lead_kind === "prospect");
    expect(prospects.map((p) => p.title)).toEqual(["Lake Pichola Haveli, Udaipur (Hotels)", "Mewar Weddings, Udaipur"]);
    expect(prospects[0].url).toBe("https://lakepicholahaveli.com");
    // the query planner was told the city and the trip
    expect(seen.find((s) => /plan web searches/i.test(s.system))?.user).toMatch(/CITIES: Udaipur[\s\S]*visits Udaipur, India/);
    // a second run never adds the same business again
    await runHunt(id, "manual", 45_000);
    expect((await one<{ n: number }>("select count(*)::int as n from sales_radar_items where hunt_id = $1 and lead_kind = 'prospect'", [id]))!.n).toBe(2);
  });

  it("scoring knows the place, the trip and that a local business did not post anything", async () => {
    const id = await addTrip();
    await q("insert into sales_radar_items (url, url_hash, title, body, hunt_id, lead_kind) values ('https://lakepicholahaveli.com', 'h1', 'Lake Pichola Haveli, Udaipur', 'Local business', $1, 'prospect')", [id]);
    await qualifyPending(30_000);
    const call = seen.find((s) => /qualify sales leads/i.test(s.system))!;
    expect(call.system).toMatch(/- prospect: a local business/);
    expect(call.user).toMatch(/CATEGORY: prospect/);
    expect(call.user).toMatch(/TARGET PLACE: Udaipur, India \(the owner is there .* and wants to meet businesses in person\)/);
    expect((await one<{ status: string }>("select status from sales_radar_items where hunt_id = $1", [id]))!.status).toBe("qualified");
  });

  it("waits for its start day and stops after its last day", async () => {
    const later = await saveHunt({ name: "Later", brief: "x", starts_on: addDays(today, 3), schedule: "interval", every_hours: 1, window_from: 0, window_to: 24 });
    const now = await saveHunt({ name: "Now", brief: "x", schedule: "interval", every_hours: 1, window_from: 0, window_to: 24 });
    await q("update sales_hunts set next_run_at = now() - interval '1 minute'");
    await scheduleHunts(new Date());
    const queued = (await q<{ payload: { id: number } }>("select payload from sales_jobs where kind = 'hunt_run'")).map((j) => j.payload.id);
    expect(queued).toContain(now);
    expect(queued).not.toContain(later);
    const trip = await addTrip({ trip_from: addDays(today, -4), trip_to: addDays(today, -1) });
    expect(await endFinishedTargets(today)).toBe(1);
    expect(await one("select enabled, ended_at is not null as ended from sales_hunts where id = $1", [trip])).toEqual({ enabled: false, ended: true });
    // editing it (a longer trip) brings it back
    await saveHunt({ trip_to: addDays(today, 2), trip_from: addDays(today, -4) }, trip);
    expect(await one("select ended_at from sales_hunts where id = $1", [trip])).toEqual({ ended_at: null });
  });

  it("booking a meeting makes the lead a deal and puts it on the trip plan, in your timezone", async () => {
    const id = await addTrip();
    const it = (await one<{ id: number }>("insert into sales_radar_items (url, url_hash, title, body, hunt_id, lead_kind, status, score, fit) values ('https://lakepicholahaveli.com', 'h2', 'Lake Pichola Haveli, Udaipur', 'Local business', $1, 'prospect', 'qualified', 70, '{\"company\":\"Lake Pichola Haveli\",\"website\":\"https://lakepicholahaveli.com\"}') returning id", [id]))!;
    expect((await tripFor(it.id))?.city).toBe("Udaipur");
    const day = addDays(today, 16);
    const r = await bookLeadMeeting(it.id, day, "11:00");
    const m = await one<{ title: string; place: string; at: string; deal_id: number }>("select title, place, to_char(starts_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as at, deal_id from sales_meetings where id = $1", [r.meeting_id]);
    expect(m).toEqual({ title: "Meet Lake Pichola Haveli in Udaipur", place: "Udaipur", at: `${day} 11:00`, deal_id: r.deal_id });
    expect((await one<{ status: string }>("select status from sales_radar_items where id = $1", [it.id]))!.status).toBe("converted");
    expect(await one("select summary from sales_interactions where deal_id = $1 and channel = 'meeting'", [r.deal_id])).toMatchObject({ summary: expect.stringMatching(/^Meeting booked: .* at 11:00 in Udaipur$/) });
    expect((await tripMeetings(id)).map((x) => x.id)).toEqual([r.meeting_id]);
    // booking the same day again moves it, it does not double book
    await bookLeadMeeting(it.id, day, "15:30");
    expect((await tripMeetings(id)).length).toBe(1);
    await expect(bookLeadMeeting(it.id, "soon", "11:00")).rejects.toThrow(/date and a time/);
  });
});
