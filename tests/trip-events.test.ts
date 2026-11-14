// Events around a trip: your communities first, only events a page names, dates checked against the page, inside
// a window of 5 days before to 5 days after, nothing already over; "I'll go" puts them on the trip plan.
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushed: string[] = [];
vi.mock("@/lib/sales/notify", () => ({ push: vi.fn(async (t: string) => { pushed.push(t); }) }));
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real, llmConfigured: () => true,
    llmJson: vi.fn(async (system: string) => {
      if (/pick events worth attending/i.test(system)) {
        return { events: [
          { title: "JITO Udaipur Business Connect", url: "https://jito.org/udaipur/connect", starts_on: "2026-12-05", kind: "community", venue: "Hotel Lakend", why: "Jain business owners from Udaipur" },
          { title: "Udaipur Startup Summit 2026", url: "https://allevents.in/udaipur/summit", starts_on: "2026-12-02", ends_on: "2026-12-03", kind: "startup", why: "Founders and investors" },
          { title: "Rajasthan AI Conclave", url: "https://news.example/ai", starts_on: "2026-12-09", kind: "tech", why: "Guessed date" },
          { title: "Invented Mega Expo", url: "https://nowhere.example", starts_on: "2026-12-01" },
          { title: "Jaipur Literature Night", url: "https://allevents.in/jaipur/lit", starts_on: "2027-01-20" },
        ] };
      }
      return {};
    }),
  };
});
vi.mock("@/lib/sales/search", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/search")>();
  return {
    ...real, geminiSearchReady: () => false,
    webSearch: vi.fn(async () => [
      { title: "JITO Udaipur Business Connect", url: "https://jito.org/udaipur/connect", snippet: "JITO Udaipur chapter presents Business Connect on 5th December at Hotel Lakend." },
      { title: "Udaipur Startup Summit 2026 | allevents", url: "https://allevents.in/udaipur/summit", snippet: "Join founders on Dec 2 and 3 in Udaipur." },
      { title: "Rajasthan AI Conclave announced", url: "https://news.example/ai", snippet: "The Rajasthan AI Conclave will be held in Jaipur later this year." },
      { title: "Jaipur Literature Night", url: "https://allevents.in/jaipur/lit", snippet: "20 Jan 2027" },
    ]),
  };
});

import { one, q } from "@/lib/db";
import { saveHunt } from "@/lib/sales/hunts";
import { eventQueries, eventWindow, findTripEvents, groundEvents, setTripEventStatus, textShowsDate, tripEvents } from "@/lib/sales/targets";

describe("events around a trip, in words", () => {
  it("looks from 5 days before to 5 days after", () => {
    expect(eventWindow("2026-12-01", "2026-12-04")).toEqual({ from: "2026-11-26", to: "2026-12-09" });
  });

  it("searches your communities first, the region too, then business, startup and industry events", () => {
    const qs = eventQueries({ cities: ["Udaipur"], countries: ["India"], industries: ["Hotels"], trip_from: "2026-12-01", trip_to: "2026-12-04", region: "Rajasthan" }, ["JITO (Jain International Trade Organisation)"]);
    expect(qs[0]).toBe("JITO Udaipur event November 2026 OR December 2026");
    expect(qs[1]).toMatch(/^JITO Rajasthan chapter/);
    expect(qs.join("\n")).toMatch(/business networking[\s\S]*startup meetup[\s\S]*Rajasthan Hotels conference/);
    expect(eventQueries({ cities: [], countries: [], industries: [], trip_from: null, trip_to: null }, [])).toEqual([]);
  });

  it("reads dates the way pages write them", () => {
    expect(textShowsDate("on 5th December at", "2026-12-05")).toBe(true);
    expect(textShowsDate("Dec 2 and 3", "2026-12-02")).toBe(true);
    expect(textShowsDate("05/12/2026", "2026-12-05")).toBe(true);
    expect(textShowsDate("2026-12-05", "2026-12-05")).toBe(true);
    expect(textShowsDate("later this year", "2026-12-09")).toBe(false);
    expect(textShowsDate("15 December", "2026-12-05")).toBe(false);
  });

  it("keeps only named events in the window; a date the page does not show is dropped, not guessed", () => {
    const hits = [
      { title: "JITO Udaipur Business Connect", url: "https://jito.org/u", snippet: "on 5 Dec" },
      { title: "Rajasthan AI Conclave", url: "https://n.example", snippet: "later this year" },
      { title: "Old meetup", url: "https://o.example", snippet: "27 Nov" },
    ];
    const out = groundEvents([
      { title: "Rajasthan AI Conclave", url: "https://n.example", starts_on: "2026-12-03" },
      { title: "JITO Udaipur Business Connect", url: "https://wrong.example", starts_on: "2026-12-05" },
      { title: "Made Up Fest", url: "https://jito.org/u", starts_on: "2026-12-02" },
      { title: "Old meetup", url: "https://o.example", starts_on: "2026-11-27" },
    ], hits, { from: "2026-11-26", to: "2026-12-09" }, "2026-11-28", ["JITO (Jain International Trade Organisation)"]);
    expect(out.map((e) => [e.title, e.starts_on, e.date_confirmed, e.community, e.url])).toEqual([
      ["JITO Udaipur Business Connect", "2026-12-05", true, "JITO", "https://jito.org/u"],
      ["Rajasthan AI Conclave", null, false, null, "https://n.example"],
    ]);
  });
});

describe("finding them for a real trip", () => {
  beforeEach(async () => {
    pushed.length = 0;
    await q("truncate sales_hunts, sales_trip_events, sales_jobs restart identity cascade");
  });

  it("stores grounded events, yours first, tells you once, and I'll go is remembered", async () => {
    const id = await saveHunt({ name: "Udaipur trip", kind: "trip", brief: "x", cities: ["Udaipur"], countries: ["India"], region: "Rajasthan", trip_from: "2026-12-01", trip_to: "2026-12-04" });
    expect(await findTripEvents(id)).toBe(3);
    const ev = await tripEvents(id);
    expect(ev.map((e) => [e.title, e.starts_on, e.ends_on, e.date_confirmed, e.community])).toEqual([
      ["JITO Udaipur Business Connect", "2026-12-05", "2026-12-05", true, "JITO"],
      ["Udaipur Startup Summit 2026", "2026-12-02", "2026-12-03", true, null],
      ["Rajasthan AI Conclave", null, null, false, null],
    ]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatch(/3 events around your dates[\s\S]*⭐ <b>JITO Udaipur Business Connect<\/b> · Sat 5 Dec/);
    expect((await one<{ checked: boolean }>("select events_checked_at is not null as checked from sales_hunts where id = $1", [id]))!.checked).toBe(true);
    // a second look adds nothing new and stays quiet
    expect(await findTripEvents(id)).toBe(0);
    expect(pushed).toHaveLength(1);
    await setTripEventStatus(ev[0].id!, "going");
    expect((await tripEvents(id))[0].status).toBe("going");
  });

  it("a trip run queues the events search once a day; an ongoing target never does", async () => {
    const { queueTripEvents } = await import("@/lib/sales/targets");
    const trip = await saveHunt({ name: "T", kind: "trip", brief: "x", cities: ["Udaipur"], trip_from: "2026-12-01", trip_to: "2026-12-04" });
    expect(await queueTripEvents(trip)).toBe(true);
    await q("update sales_hunts set events_checked_at = now() where id = $1", [trip]);
    expect(await queueTripEvents(trip)).toBe(false);
    expect(await queueTripEvents(trip, true)).toBe(true);
    const plain = await saveHunt({ name: "P", brief: "x" });
    await expect(queueTripEvents(plain, true)).rejects.toThrow(/trip dates/);
  });
});
