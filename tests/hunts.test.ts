import { beforeEach, describe, expect, it, vi } from "vitest";

const ai: { queries: unknown; calls: { system: string; user: unknown }[] } = { queries: { queries: [] }, calls: [] };
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real,
    llmConfigured: () => true,
    llmJson: vi.fn(async (system: string, user: unknown) => {
      ai.calls.push({ system, user });
      // the qualifier asks for an array of verdicts, the planner for {queries}
      if (/qualify sales leads/.test(system)) {
        // one verdict per item, decided by its title, whatever order the items arrive in
        return [...String(user).matchAll(/#(\d+) CATEGORY[\s\S]*?TITLE: ([^\n]*)/g)].map((m) =>
          /Good|Chatbot|Need|Hiring/.test(m[2]) ? { i: Number(m[1]), score: 88, buyer: "direct_client", why: "fits", angle: "offer a demo" } : { i: Number(m[1]), score: 20, buyer: "other", why: "no", angle: "" });
      }
      return ai.queries;
    }),
  };
});
const hits: { title: string; url: string; snippet: string }[][] = [];
const providers: { list: string[] } = { list: ["tavily", "duckduckgo"] };
vi.mock("@/lib/sales/search", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/search")>();
  return { ...real, webSearch: vi.fn(async () => hits.shift() ?? []), searchConfigured: () => providers.list };
});
vi.mock("@/lib/sales/notify", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/notify")>();
  return { ...real, push: vi.fn(async () => 1) };
});

import { q, one } from "@/lib/db";
import { describeSchedule, nextRunAfter, runsPerDay, searchesPerDay, type Schedule } from "@/lib/sales/hunt-schedule";
import { listHunts, planQueries, reportHunt, runHunt, runHuntNow, saveHunt, scheduleHunts, setHuntEnabled, templateQueries, validateHunt, type HuntRow } from "@/lib/sales/hunts";
import { qualifyPending } from "@/lib/sales/radar";
import { push } from "@/lib/sales/notify";
import { ist } from "./helpers";

const TZ = "Asia/Kolkata";
const sched = (o: Partial<Schedule>): Schedule => ({ schedule: "at", every_hours: 1, at_time: "09:00", days: [1, 2, 3, 4, 5, 6, 7], window_from: 0, window_to: 24, ...o });

beforeEach(async () => {
  await q("truncate sales_hunts, sales_hunt_runs, sales_radar_items, sales_jobs restart identity cascade");
  await q("update sales_settings set config = '{}'::jsonb");
  ai.queries = { queries: [] };
  ai.calls = [];
  hits.length = 0;
  providers.list = ["tavily", "duckduckgo"];
  vi.mocked(push).mockClear();
});

describe("hunt schedules", () => {
  it("runs at a set time, today if it has not passed, otherwise the next allowed day", () => {
    const daily = sched({ schedule: "at", at_time: "09:00" });
    expect(nextRunAfter(daily, ist("2026-11-06 08:00"), TZ)).toEqual(ist("2026-11-06 09:00"));
    expect(nextRunAfter(daily, ist("2026-11-06 10:00"), TZ)).toEqual(ist("2026-11-07 09:00"));
    // Friday 10:00, weekdays only: the next run is Monday
    expect(nextRunAfter(sched({ days: [1, 2, 3, 4, 5] }), ist("2026-11-06 10:00"), TZ)).toEqual(ist("2026-11-09 09:00"));
  });

  it("runs every N hours inside its window and waits for the window to reopen", () => {
    const hourly = sched({ schedule: "interval", every_hours: 1, window_from: 8, window_to: 20 });
    expect(nextRunAfter(hourly, ist("2026-11-06 10:00"), TZ)).toEqual(ist("2026-11-06 11:00"));
    expect(nextRunAfter(hourly, ist("2026-11-06 19:30"), TZ)).toEqual(ist("2026-11-07 08:00"));
    expect(nextRunAfter(hourly, ist("2026-11-06 03:00"), TZ)).toEqual(ist("2026-11-06 08:00"));
    expect(nextRunAfter(sched({ schedule: "interval", every_hours: 3 }), ist("2026-11-06 07:00"), TZ)).toEqual(ist("2026-11-06 10:00"));
    // Saturday night, weekdays only: Monday morning
    expect(nextRunAfter(sched({ schedule: "interval", every_hours: 1, window_from: 9, window_to: 18, days: [1, 2, 3, 4, 5] }), ist("2026-11-07 20:00"), TZ)).toEqual(ist("2026-11-09 09:00"));
  });

  it("describes schedules and estimates their cost in plain numbers", () => {
    expect(describeSchedule(sched({}))).toBe("Daily at 09:00");
    expect(describeSchedule(sched({ days: [1, 2, 3, 4, 5] }))).toBe("Weekdays at 09:00");
    expect(describeSchedule(sched({ days: [1, 3], at_time: "07:30" }))).toBe("Mon, Wed at 07:30");
    expect(describeSchedule(sched({ schedule: "interval", every_hours: 1 }))).toBe("Every hour");
    expect(describeSchedule(sched({ schedule: "interval", every_hours: 3, window_from: 8, window_to: 20 }))).toBe("Every 3 hours, 08:00 to 20:00");
    expect(runsPerDay(sched({ schedule: "interval", every_hours: 1 }))).toBe(24);
    expect(searchesPerDay(sched({ schedule: "interval", every_hours: 1 }), 6, 2)).toBe(192);
    expect(searchesPerDay(sched({}), 8, 0)).toBe(8);
  });
});

describe("hunt setup", () => {
  it("rejects incomplete or impossible hunts with a clear reason", () => {
    expect(() => validateHunt({ name: "", brief: "x" })).toThrow(/name/);
    expect(() => validateHunt({ name: "a", brief: "", keywords: [] })).toThrow(/Describe who/);
    expect(() => validateHunt({ name: "a", brief: "x", days: [] } as never)).toThrow(/day/);
    expect(() => validateHunt({ name: "a", brief: "x", window_from: 10, window_to: 10, days: [1], at_time: "09:00", every_hours: 1, queries_per_run: 5, signals: ["hiring"] })).toThrow(/active hours/);
    expect(() => validateHunt({ name: "a", brief: "x", at_time: "9am", days: [1] } as never)).toThrow(/Time/);
    expect(() => validateHunt({ name: "a", brief: "x", signals: ["bogus"], at_time: "09:00", days: [1], every_hours: 1, window_from: 0, window_to: 24, queries_per_run: 5 })).toThrow(/signal/);
  });

  it("saves, schedules the first run, and pauses and resumes", async () => {
    const id = await saveHunt({ name: "Gulf", brief: "logistics founders", schedule: "interval", every_hours: 1, signals: ["requirement"], days: [1, 2, 3, 4, 5, 6, 7], at_time: "09:00", window_from: 0, window_to: 24, queries_per_run: 4 });
    const h = (await one<HuntRow>("select * from sales_hunts where id = $1", [id]))!;
    expect(new Date(h.next_run_at!).getTime()).toBeGreaterThan(Date.now());
    await setHuntEnabled(id, false);
    expect((await one<HuntRow>("select * from sales_hunts where id = $1", [id]))!.next_run_at).toBeNull();
    await setHuntEnabled(id, true);
    expect((await one<HuntRow>("select * from sales_hunts where id = $1", [id]))!.next_run_at).not.toBeNull();
    expect((await listHunts())[0].searches_per_day).toBe(96);
  });
});

describe("the minute tick", () => {
  async function hunt() {
    return saveHunt({ name: "Tick", brief: "anything", signals: ["requirement"], schedule: "interval", every_hours: 1, days: [1, 2, 3, 4, 5, 6, 7], at_time: "09:00", window_from: 0, window_to: 24, queries_per_run: 3 });
  }
  const jobs = () => q<{ payload: { id: number; trigger: string } }>("select payload from sales_jobs where kind = 'hunt_run'");

  it("queues a due hunt exactly once and moves it to its next slot", async () => {
    const id = await hunt();
    expect(await scheduleHunts()).toBe(0); // not due yet
    await q("update sales_hunts set next_run_at = now() - interval '2 minutes' where id = $1", [id]);
    expect(await scheduleHunts()).toBe(1);
    expect(await scheduleHunts()).toBe(0); // the slot moved on
    const queued = await jobs();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ id, trigger: "schedule" });
    expect(new Date((await one<HuntRow>("select * from sales_hunts where id = $1", [id]))!.next_run_at!).getTime()).toBeGreaterThan(Date.now());
  });

  it("two ticks racing queue it once", async () => {
    const id = await hunt();
    await q("update sales_hunts set next_run_at = now() - interval '2 minutes' where id = $1", [id]);
    await Promise.all([scheduleHunts(), scheduleHunts()]);
    expect(await jobs()).toHaveLength(1);
  });

  it("a hunt with no slot yet gets one without running; a paused hunt never runs", async () => {
    const id = await hunt();
    await q("update sales_hunts set next_run_at = null where id = $1", [id]);
    expect(await scheduleHunts()).toBe(0);
    expect((await one<HuntRow>("select * from sales_hunts where id = $1", [id]))!.next_run_at).not.toBeNull();
    await q("update sales_hunts set enabled = false, next_run_at = now() - interval '1 hour' where id = $1", [id]);
    expect(await scheduleHunts()).toBe(0);
  });

  it("run now queues a manual run once", async () => {
    const id = await hunt();
    await runHuntNow(id);
    await runHuntNow(id);
    expect((await jobs()).map((j) => j.payload.trigger)).toEqual(["manual"]);
  });
});

describe("a hunt run", () => {
  const make = (o: object = {}) => saveHunt({ name: "Gulf logistics", brief: "Logistics owners drowning in WhatsApp orders", signals: ["requirement", "hiring"], sweep_sources: false, queries_per_run: 4, keywords: ["need a chatbot"], countries: ["United Arab Emirates"], industries: ["Logistics"], schedule: "at", at_time: "09:00", days: [1, 2, 3, 4, 5, 6, 7], every_hours: 1, window_from: 0, window_to: 24, ...o });

  it("plans fresh queries with the AI, searches, stores the results tagged to the hunt, and queues scoring and a report", async () => {
    ai.queries = { queries: ["site:reddit.com logistics owner manual orders whatsapp", "dubai logistics company hiring data entry 2026", "site:reddit.com logistics owner manual orders whatsapp"] };
    hits.push(
      [{ title: "Need automation for my freight business", url: "https://reddit.com/r/x/1", snippet: "We take orders on WhatsApp all day" }],
      [{ title: "Hiring 5 data entry clerks, Dubai", url: "https://jobs.example/2", snippet: "Logistics firm" }],
      [{ title: "Chatbot wanted", url: "https://forum.example/3", snippet: "need a chatbot for shipments" }],
    );
    const id = await make();
    const r = await runHunt(id, "manual", 30_000);
    expect(r.searched).toBe(3); // 1 keyword + 2 distinct AI queries
    expect(r.found).toBe(3);
    const run = (await one<{ status: string; queries: string[]; found: number }>("select * from sales_hunt_runs where id = $1", [r.runId]))!;
    expect(run.status).toBe("ok");
    expect(run.queries[0]).toBe("need a chatbot"); // your exact phrase always goes first
    expect(new Set(run.queries).size).toBe(run.queries.length);
    const items = await q<{ hunt_id: number; hunt_run_id: number; body: string }>("select hunt_id, hunt_run_id, body from sales_radar_items");
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.hunt_id === id && i.hunt_run_id === r.runId && i.body.startsWith("[hunt: Gulf logistics]"))).toBe(true);
    const kinds = (await q<{ kind: string }>("select kind from sales_jobs order by id")).map((j) => j.kind);
    expect(kinds).toEqual(expect.arrayContaining(["radar_qualify", "hunt_report"]));
  });

  it("does not repeat queries it used on earlier runs, and tells the AI what you kept and rejected", async () => {
    const id = await make({ keywords: [] });
    await q("insert into sales_hunt_runs (hunt_id, queries, status) values ($1, $2, 'ok')", [id, ["old query one"]]);
    await q("insert into sales_radar_items (url_hash, title, status, hunt_id, deal_id) values ('a','Kept lead',  'converted', $1, null), ('b','Skipped lead','skipped',$1,null)", [id]);
    ai.queries = { queries: ["old query one", "brand new query"] };
    const h = (await one<HuntRow>("select * from sales_hunts where id = $1", [id]))!;
    const plan = await planQueries(h, 20_000);
    expect(plan.by).toBe("ai");
    expect(plan.queries).toEqual(["brand new query"]);
    const user = String(ai.calls.at(-1)!.user);
    expect(user).toContain("Kept lead");
    expect(user).toContain("Skipped lead");
    expect(user).toContain("old query one");
    expect(user).toContain("Logistics owners drowning");
  });

  it("falls back to templates when the AI gives nothing, and the templates vary run to run", async () => {
    const id = await make({ keywords: [] });
    ai.queries = { queries: [] };
    const h = (await one<HuntRow>("select * from sales_hunts where id = $1", [id]))!;
    const plan = await planQueries(h, 20_000);
    expect(plan.by).toBe("template");
    expect(plan.queries.length).toBeGreaterThan(0);
    expect(plan.queries.join(" ")).toContain("United Arab Emirates");
    const a = templateQueries(h, { country: "x", industry: "y" }, 4, 0);
    const b = templateQueries(h, { country: "x", industry: "y" }, 4, 1);
    expect(a).not.toEqual(b);
  });

  it("says plainly when nothing was found and no search key is set", async () => {
    providers.list = ["duckduckgo"];
    const id = await make();
    await runHunt(id, "manual", 20_000);
    const run = (await one<{ status: string; error: string }>("select status, error from sales_hunt_runs"))!;
    expect(run.status).toBe("error");
    expect(run.error).toMatch(/TAVILY_API_KEY/);
  });

  it("scores against the hunt's brief, applies its own minimum, and reports the good ones to Telegram", async () => {
    const id = await make({ min_score: 70 });
    hits.push([{ title: "Good one", url: "https://a.example/1", snippet: "s" }, { title: "Weak one", url: "https://a.example/2", snippet: "s" }]);
    const { runId } = await runHunt(id, "manual", 20_000);
    await reportHunt(runId);
    const rows = await q<{ title: string; status: string; score: number }>("select title, status, score from sales_radar_items order by id");
    expect(rows).toEqual(expect.arrayContaining([{ title: "Good one", status: "qualified", score: 88 }, { title: "Weak one", status: "rejected", score: 20 }]));
    const qualifyCall = ai.calls.filter((c) => /qualify sales leads/.test(c.system)).at(-1)!;
    expect(String(qualifyCall.user)).toContain("WHAT THE OWNER ASKED THIS HUNT TO FIND: Logistics owners");
    expect(push).toHaveBeenCalledTimes(2); // the hot-lead alert and the hunt report
    expect(String(vi.mocked(push).mock.calls.at(-1)![0])).toContain("Gulf logistics");
  });

  it("stays quiet when notifications are off", async () => {
    const id = await make({ notify: false });
    hits.push([{ title: "Good one", url: "https://a.example/9", snippet: "s" }, { title: "Other", url: "https://a.example/8", snippet: "s" }]);
    const { runId } = await runHunt(id, "manual", 20_000);
    await reportHunt(runId);
    expect(push).not.toHaveBeenCalled();
    expect((await one<{ status: string }>("select status from sales_radar_items where title = 'Good one'"))!.status).toBe("qualified");
  });
});

describe("sales data is locked to the owner", () => {
  it("every sales table has row-level security, so the public API key reads nothing", async () => {
    const open = await q<{ relname: string }>(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'sales\\_%' and not c.relrowsecurity",
    );
    expect(open.map((r) => r.relname)).toEqual([]);
  });
});
