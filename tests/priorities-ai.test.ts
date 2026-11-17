// Sort with AI: only real tasks, only real boxes, nothing saved until accepted, and no AI means no value guesses.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { q } from "@/lib/db";
import { matrixTasks, suggestBoxes } from "@/lib/services/matrix";
import { ctxAt, resetDb } from "./helpers";

const ai = vi.hoisted(() => ({ on: true, answer: null as unknown, prompt: "" }));
vi.mock("@/lib/sales/llm", () => ({
  llmConfigured: () => ai.on,
  llmJson: async (system: string, user: string) => { ai.prompt = `${system}\n${user}`; return ai.answer; },
}));

beforeEach(async () => {
  await resetDb();
  ai.on = true;
});

describe("Sort with AI", () => {
  it("keeps only real tasks and real boxes, and saves nothing", async () => {
    const ctx = await ctxAt("2026-11-17 10:00");
    const a = (await q<{ id: number }>("insert into tasks (title, estimate_min) values ('Send Udaipur proposal', 30) returning id"))[0].id;
    const b = (await q<{ id: number }>("insert into tasks (title, notes) values ('Rebuild agency website', 'new case studies section') returning id"))[0].id;
    ai.answer = { items: [
      { id: a, box: "quick", why: "Closes a warm lead in half an hour." },
      { id: b, box: "big", why: "Brings clients but takes days." },
      { id: 99999, box: "quick", why: "made up" },
      { id: a, box: "urgent", why: "not a box" },
    ] };
    const s = await suggestBoxes(ctx, "value");
    expect(s.map((x) => [x.id, x.box])).toEqual([[a, "quick"], [b, "big"]]);
    expect(ai.prompt).toContain("estimate 30 min");
    expect(ai.prompt).toContain("new case studies section");
    expect((await matrixTasks(ctx)).every((t) => t.value_level === null)).toBe(true);
  });

  it("without the AI: no value guesses; urgent dated tasks only on the Eisenhower board", async () => {
    ai.on = false;
    const ctx = await ctxAt("2026-11-17 10:00");
    await q("insert into tasks (title, due_date) values ('Pay GST', '2026-11-18'), ('Read a book', null)");
    expect(await suggestBoxes(ctx, "value")).toEqual([]);
    expect((await suggestBoxes(ctx, "eisen")).map((x) => [x.title, x.box])).toEqual([["Pay GST", "do"]]);
  });
});
