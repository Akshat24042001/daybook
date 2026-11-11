import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPool, one, q } from "@/lib/db";
import { setRadarHidden, syncCatalog } from "@/lib/sales/radar";
import { radarPlan } from "@/lib/sales/radar-plan";
import { listMoves, refreshMoves } from "@/lib/sales/moves";
import { webSearch } from "@/lib/sales/search";
import { allTasks, reopenTask, taskLog } from "@/lib/services/tasks";
import { setEntryStatus, entriesForDate } from "@/lib/services/entries";
import { add, ctxAt, resetDb } from "./helpers";

beforeEach(async () => {
  await q("truncate sales_radar_items, sales_moves, sales_search_log, sales_hunts restart identity cascade");
});
afterEach(() => vi.unstubAllGlobals());

const lead = (n: number) => q("insert into sales_radar_items (url_hash, title, status, score) values ($1, $2, 'qualified', 90)", [`h${n}`, `Lead ${n}`]);

describe("hiding leads", () => {
  it("hides and unhides without deleting, and hidden leads stop surfacing as moves", async () => {
    await lead(1);
    await lead(2);
    await refreshMoves();
    expect((await listMoves({ horizonHours: 24 * 7 })).filter((m) => m.kind === "radar")).toHaveLength(2);
    expect(await setRadarHidden([1], true)).toBe(1);
    expect(await setRadarHidden([1], true)).toBe(0); // already hidden
    await refreshMoves();
    expect((await listMoves({ horizonHours: 24 * 7 })).filter((m) => m.kind === "radar").map((m) => m.title)).toEqual(["Lead 2"]);
    expect((await one<{ n: number }>("select count(*)::int as n from sales_radar_items"))!.n).toBe(2);
    expect(await setRadarHidden([1], false)).toBe(1);
    expect(await setRadarHidden([], true)).toBe(0);
  });
});

describe("the search log and the plan", () => {
  it("records what was searched, where, how many results and who asked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      `<a class="result__a" href="https://example.com/a">Hit title</a><a class="result__snippet">a snippet</a>`, { status: 200 })));
    await webSearch("logistics founders need automation", 5, "hunt: Gulf");
    const row = (await one<{ provider: string; query: string; hits: number; label: string }>("select * from sales_search_log where provider = 'duckduckgo'"))!;
    expect(row).toMatchObject({ provider: "duckduckgo", query: "logistics founders need automation", hits: 1, label: "hunt: Gulf" });
    // an engine that refuses this server is logged as an error, never as an empty result
    const bingRow = (await one<{ hits: number; error: string | null }>("select hits, error from sales_search_log where provider = 'bing'"))!;
    expect(bingRow.hits).toBe(0);
    expect(bingRow.error).toMatch(/refused/);
  });

  it("explains the focus, the next 7 days, the platforms, the sources and the searches", async () => {
    await syncCatalog(getPool()); // other test files clear the source list
    await q("insert into sales_search_log (provider, query, hits, label) values ('tavily','q one',4,'source: x')");
    const p = await radarPlan();
    expect(p.now.country).toBeTruthy();
    expect(p.rotation).toHaveLength(7);
    expect(p.rotation[0].today).toBe(true);
    expect(p.platforms.map((x) => x.name)).toEqual(expect.arrayContaining(["Tavily", "DuckDuckGo", "Telegram"]));
    expect(p.searches.used24h).toBe(1);
    expect(p.searches.byProvider).toEqual([{ provider: "tavily", n: 1 }]);
    expect(p.recent[0].query).toBe("q one");
    expect(p.sources.length).toBeGreaterThan(50);
    expect(p.sources.find((s) => s.kind === "search")?.target).toMatch(/^Web search: “/);
    expect(p.sources.every((s) => !/\{country\}|\{industry\}/.test(s.target))).toBe(true);
  });
});

describe("all tasks", () => {
  it("lists every task whatever its state, logs what was done, and reopens closed ones", async () => {
    await resetDb();
    const ctx = await ctxAt("2026-09-19 09:00");
    await add(ctx, "Finish report");
    await add(ctx, "Cancel gym");
    await add(ctx, "Still open");
    const entries = await entriesForDate(ctx.today);
    const byTitle = (t: string) => entries.find((e) => e.title === t)!;
    await setEntryStatus(ctx, byTitle("Finish report").id, "done");
    await setEntryStatus(ctx, byTitle("Cancel gym").id, "dropped");
    const tasks = await allTasks();
    const state = (t: string) => tasks.find((x) => x.title === t)!.state;
    expect(tasks).toHaveLength(3);
    expect(state("Finish report")).toBe("done");
    expect(state("Cancel gym")).toBe("dropped");
    expect(state("Still open")).toBe("active");
    expect((await taskLog()).map((l) => `${l.title}:${l.status}`).sort()).toEqual(["Cancel gym:dropped", "Finish report:done"]);
    await reopenTask(byTitle("Cancel gym").task_id);
    expect((await allTasks()).find((x) => x.title === "Cancel gym")!.state).toBe("active");
    await expect(reopenTask(99999)).rejects.toThrow(/no longer exists/);
  });
});
