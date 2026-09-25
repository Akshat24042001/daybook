import { describe, expect, it } from "vitest";
import { applySuggestion, insertChip, personToken, suggestionsFor, SYNTAX_CHIPS } from "@/lib/quick-add-hints";
import { parseQuickAdd } from "@/lib/parser";

const names = { projects: ["Aivaura", "Daybook App", "Talenlo"], people: ["Rahul Mehta", "Meera"] };
const ctx = { now: new Date("2026-09-19T06:30:00Z"), tz: "Asia/Kolkata", boundaryMin: 240 };

describe("quick-add helper", () => {
  it("suggests people for +, and the inserted token parses back to the full name", () => {
    const s = suggestionsFor("Call +ra", 8, names);
    expect(s.map((x) => x.label)).toEqual(["Rahul Mehta"]);
    const r = applySuggestion("Call +ra", 8, s[0]);
    expect(r.text).toBe("Call +RahulMehta ");
    expect(parseQuickAdd(r.text, ctx).person).toBe("Rahul Mehta");
  });

  it("suggests days for @, estimates for ~ and repeats for *", () => {
    expect(suggestionsFor("Gym @t", 6, names).map((x) => x.replace)).toEqual(["@today", "@tom", "@tue", "@thu"]);
    expect(suggestionsFor("Report ~1", 9, names).map((x) => x.replace)).toEqual(["~15m", "~1h"]);
    expect(suggestionsFor("Post *7", 7, names).map((x) => x.replace)).toEqual(["*7d"]);
    expect(suggestionsFor("Call +meh", 9, names).map((x) => x.label)).toEqual(["Rahul Mehta"]);
  });

  it("completes a project at the start of the line, including multi-word names, and not once a project is set", () => {
    expect(suggestionsFor("aiv", 3, names).map((x) => x.replace)).toEqual(["Aivaura:"]);
    expect(suggestionsFor("Daybook A", 9, names).map((x) => x.replace)).toEqual(["Daybook App:"]);
    const r = applySuggestion("aiv", 3, { replace: "Aivaura:", label: "Aivaura:", hint: "project" });
    expect(r.text).toBe("Aivaura: ");
    expect(parseQuickAdd(`${r.text}send quote`, ctx).project).toBe("Aivaura");
    expect(suggestionsFor("Aivaura: aiv", 12, names)).toEqual([]);
    expect(suggestionsFor("a", 1, names)).toEqual([]); // too short
  });

  it("syntax chips append cleanly and every chip is understood by the parser", () => {
    expect(insertChip("Finish report", SYNTAX_CHIPS[0])).toBe("Finish report !! ");
    expect(insertChip("", SYNTAX_CHIPS[0])).toBe("!! ");
    expect(insertChip("Call", SYNTAX_CHIPS.find((c) => c.insert === "+")!)).toBe("Call +");
    for (const c of SYNTAX_CHIPS.filter((x) => x.insert !== "+")) {
      const p = parseQuickAdd(`Write the proposal ${c.insert}`, ctx);
      expect(p.errors, c.insert).toEqual([]);
      expect(p.title, c.insert).toBe("Write the proposal");
    }
  });

  it("turns names into parser-friendly tokens", () => {
    expect(personToken("harsh joshi")).toBe("HarshJoshi");
    expect(personToken("Meera")).toBe("Meera");
  });
});
