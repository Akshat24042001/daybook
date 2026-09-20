import { describe, expect, it } from "vitest";
import { describeParsed, parseQuickAdd, type ParseContext } from "@/lib/parser";
import { findSimilar } from "@/lib/fuzzy";
import { fmtHM } from "@/lib/time";

const TZ = "Asia/Kolkata";
// Saturday 19 Sep 2026, 14:00 IST
const at14: ParseContext = { now: new Date("2026-09-19T08:30:00Z"), tz: TZ, boundaryMin: 240 };
// Same day, 18:00 IST (5 PM has passed)
const at18: ParseContext = { now: new Date("2026-09-19T12:30:00Z"), tz: TZ, boundaryMin: 240 };
const p = (s: string, ctx = at14) => parseQuickAdd(s, ctx);

describe("quick-add: plain text and every token row", () => {
  it("plain text is a one-off with the whole line as the title", () => {
    const r = p("Industry study");
    expect(r).toMatchObject({ title: "Industry study", type: "one_off", project: null, mustDo: false, targetDate: "2026-09-19" });
    expect(r.errors).toEqual([]);
  });

  it("Name: title creates a project prefix", () => {
    const r = p("Vector: Insights");
    expect(r.project).toBe("Vector");
    expect(r.title).toBe("Insights");
  });

  it("does not treat times or URLs as a project prefix", () => {
    expect(p("call at 10:30 sharp").project).toBeNull();
    expect(p("read https://example.com/x").project).toBeNull();
  });

  it("!! marks must-do", () => {
    const r = p("DRAC: Events !!");
    expect(r).toMatchObject({ project: "DRAC", title: "Events", mustDo: true });
  });

  it("@5pm and @17:00 are times today", () => {
    const a = p("Karmit callback @5pm");
    expect(a.title).toBe("Karmit callback");
    expect(a.timeMin).toBe(17 * 60);
    expect(fmtHM(a.dueAt!, TZ)).toBe("17:00");
    expect(a.targetDate).toBe("2026-09-19");
    const b = p("Karmit callback @17:00");
    expect(b.dueAt!.getTime()).toBe(a.dueAt!.getTime());
  });

  it("bare hours 1-7 are PM, 8-11 AM", () => {
    expect(p("x @5").timeMin).toBe(17 * 60);
    expect(p("x @1").timeMin).toBe(13 * 60);
    expect(p("x @7:30").timeMin).toBe(19 * 60 + 30);
    expect(p("x @9", { ...at14, now: new Date("2026-09-19T00:00:00Z") }).timeMin).toBe(9 * 60);
    expect(p("x @11").timeMin).toBe(11 * 60);
    expect(p("x @12").timeMin).toBe(12 * 60);
    expect(p("x @5am").timeMin).toBe(5 * 60);
    expect(p("x @12am").timeMin).toBe(0);
    expect(p("x @12pm").timeMin).toBe(12 * 60);
  });

  it("@5pm rolls to tomorrow when 5 PM has passed, and says so", () => {
    const r = p("Karmit callback @5pm", at18);
    expect(r.targetDate).toBe("2026-09-20");
    expect(fmtHM(r.dueAt!, TZ)).toBe("17:00");
    expect(r.dueAt!.toISOString()).toBe("2026-09-20T11:30:00.000Z");
    expect(r.notes.join(" ")).toMatch(/already passed.*tomorrow/i);
  });

  it("does not roll when planning a specific future day", () => {
    const r = p("x @5pm", { ...at18, defaultDate: "2026-09-20" });
    expect(r.targetDate).toBe("2026-09-20");
    expect(r.notes).toEqual([]);
  });

  it("@tom / @mon / @21sep are dates", () => {
    expect(p("Industry study @tom").date).toBe("2026-09-20");
    expect(p("Industry study @tomorrow").date).toBe("2026-09-20");
    expect(p("Industry study @mon").date).toBe("2026-09-21");
    expect(p("Industry study @sat").date).toBe("2026-09-26"); // next Saturday, not today
    expect(p("Industry study @21sep").date).toBe("2026-09-21");
    expect(p("Industry study @today").date).toBe("2026-09-19");
    expect(p("Industry study @5sep").date).toBe("2027-09-05"); // already past this year
    const r = p("Industry study @tom");
    expect(r.title).toBe("Industry study");
    expect(r.targetDate).toBe("2026-09-20");
  });

  it("@tom 11am combines a date and a time", () => {
    const r = p("Sync with team @tom 11am");
    expect(r.title).toBe("Sync with team");
    expect(r.date).toBe("2026-09-20");
    expect(r.dueAt!.toISOString()).toBe("2026-09-20T05:30:00.000Z");
    expect(r.targetDate).toBe("2026-09-20");
    const q = p("Sync @mon 5:30pm");
    expect(q.dueAt!.toISOString()).toBe("2026-09-21T12:00:00.000Z");
  });

  it("~30m / ~2h are estimates", () => {
    expect(p("Exercise study ~1h").estimateMin).toBe(60);
    expect(p("x ~30m").estimateMin).toBe(30);
    expect(p("x ~2h").estimateMin).toBe(120);
    expect(p("x ~1h30m").estimateMin).toBe(90);
    expect(p("x ~1.5h").estimateMin).toBe(90);
    expect(p("Exercise study ~1h").title).toBe("Exercise study");
  });

  it(">> is ongoing", () => {
    const r = p("Vector: Notifications >>");
    expect(r).toMatchObject({ type: "ongoing", project: "Vector", title: "Notifications" });
  });

  it("*7d is a cadence", () => {
    const r = p("LinkedIn post *7d");
    expect(r).toMatchObject({ type: "cadence", cadenceDays: 7, title: "LinkedIn post" });
    expect(p("x *0d").errors.length).toBe(1);
  });

  it("every mon / every 1st are recurring rules", () => {
    expect(p("Team review every mon")).toMatchObject({ type: "recurring", rrule: "FREQ=WEEKLY;BYDAY=MO", title: "Team review" });
    expect(p("Invoices every 1st")).toMatchObject({ type: "recurring", rrule: "FREQ=MONTHLY;BYMONTHDAY=1", title: "Invoices" });
    expect(p("Rent every 15th").rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
    expect(p("Gym every friday").rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
  });

  it("'every' without a recognised schedule stays in the title", () => {
    const r = p("Check every thing");
    expect(r.type).toBe("one_off");
    expect(r.title).toBe("Check every thing");
  });

  it("? is someday only as a standalone token", () => {
    expect(p("AI companies jumping ?").type).toBe("someday");
    expect(p("AI companies jumping ?").title).toBe("AI companies jumping");
    const q = p("Should I call him?");
    expect(q.type).toBe("one_off");
    expect(q.title).toBe("Should I call him?");
  });

  it("#w / #m / #q are targets, ~ becomes the hours goal", () => {
    const r = p("Anitas Septic proposal #w ~6h");
    expect(r).toMatchObject({ type: "target", targetPeriod: "week", goalMin: 360, estimateMin: null, title: "Anitas Septic proposal" });
    expect(p("Read #m").targetPeriod).toBe("month");
    expect(p("Read #q").targetPeriod).toBe("quarter");
  });

  it("+Name is a person; follow-up with, or requested by for personal", () => {
    const f = p("Call +HarshJoshi @3pm", at14);
    expect(f).toMatchObject({ person: "Harsh Joshi", personRole: "with", type: "follow_up", title: "Call" });
    const m = p("Buy medicines +Mom /p");
    expect(m).toMatchObject({ person: "Mom", personRole: "requested_by", isPersonal: true, type: "one_off", title: "Buy medicines" });
  });

  it("^J is the referrer", () => {
    const r = p("Bidding platform ^J");
    expect(r.via).toBe("J");
    expect(r.title).toBe("Bidding platform");
  });

  it("/p is personal", () => {
    expect(p("Buy medicines /p").isPersonal).toBe(true);
    expect(p("Read /path").isPersonal).toBe(false);
  });
});

describe("quick-add: combinations, order, case", () => {
  it("tokens may appear in any order", () => {
    const a = p("!! Vector: Insights ~2h @5pm");
    const b = p("Vector: Insights @5pm ~2h !!");
    for (const r of [a, b]) {
      expect(r).toMatchObject({ project: "Vector", title: "Insights", mustDo: true, estimateMin: 120, timeMin: 17 * 60 });
    }
  });

  it("is case-insensitive", () => {
    const r = p("vector: insights @TOM 5PM ~1H /P");
    expect(r).toMatchObject({ project: "vector", isPersonal: true, estimateMin: 60, date: "2026-09-20", timeMin: 17 * 60 });
  });

  it("handles a heavy combination", () => {
    const r = p("Vector: Notifications >> !! ~2h ^J +HarshJoshi @tom 4pm");
    expect(r).toMatchObject({
      project: "Vector", title: "Notifications", type: "ongoing", mustDo: true, estimateMin: 120,
      via: "J", person: "Harsh Joshi", date: "2026-09-20", timeMin: 16 * 60,
    });
  });

  it("precedence: target > cadence > recurring > someday > ongoing > follow-up", () => {
    expect(p("x #w *7d >> ?").type).toBe("target");
    expect(p("x *7d >> ?").type).toBe("cadence");
    expect(p("x every mon >> ?").type).toBe("recurring");
    expect(p("x >> ?").type).toBe("someday");
    expect(p("x >> +Bob").type).toBe("ongoing");
  });

  it("reports empty titles and invalid times", () => {
    expect(p("!!").errors).toContain("Add a title.");
    expect(p("").errors).toContain("Add a title.");
    expect(p("x @25:00").errors.join(" ")).toMatch(/not a valid time/);
    expect(p("x @31feb").errors.join(" ")).toMatch(/not a real date/);
  });

  it("is a pure function", () => {
    expect(p("Vector: Insights !! @5pm ~1h")).toEqual(p("Vector: Insights !! @5pm ~1h"));
  });

  it("puts times after midnight (before the boundary) on the right calendar date", () => {
    // 01:00 IST on the 20th = still logical 19th. "@2am" -> logical 19th 02:00 on calendar 20th, in the future
    const now = new Date("2026-09-19T19:00:00Z"); // 00:30 IST on the 20th, logical 19th
    const r = parseQuickAdd("Night task @2am", { now, tz: TZ, boundaryMin: 240 });
    expect(r.targetDate).toBe("2026-09-19");
    expect(r.dueAt!.toISOString()).toBe("2026-09-19T20:30:00.000Z");
  });

  it("describes the result for the preview", () => {
    const r = p("Vector: Notifications >> !!");
    const lines = describeParsed(r, { tz: TZ, today: "2026-09-19" });
    expect(lines.join(" | ")).toMatch(/Ongoing/);
    expect(lines).toContain("Project: Vector");
    expect(lines).toContain("Must-do");
  });
});

describe("duplicate guard", () => {
  const active = [
    { id: 1, title: "Insights", projectName: "Vector" },
    { id: 2, title: "Insights", projectName: "DRAC" },
    { id: 3, title: "LinkedIn post", projectName: null },
    { id: 4, title: "Industry study", projectName: null },
  ];
  it("finds a close match so the existing task can be added instead", () => {
    const m = findSimilar("Insights", "Vector", active);
    expect(m.map((x) => x.id)).toEqual([1]);
    expect(findSimilar("industry study", null, active)[0].id).toBe(4);
    expect(findSimilar("Industry studies", null, active)[0]?.id).toBe(4);
  });
  it("does not match unrelated titles or the same title in another project", () => {
    expect(findSimilar("Buy groceries", null, active)).toEqual([]);
    expect(findSimilar("Insights", "Other", active)).toEqual([]);
  });
});
