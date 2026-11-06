import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "@/lib/parser";
import { currentProject, withProject } from "@/lib/quick-add-hints";
import { extractProject, voiceToQuickAdd } from "@/lib/voice";

const KNOWN = ["Vector", "DRAC", "Home Renovation", "Aivaura"];
const ctx = { now: new Date("2026-11-06T06:00:00Z"), tz: "Asia/Kolkata", boundaryMin: 240 };

describe("saying a project out loud", () => {
  it("understands the ways people actually say it", () => {
    expect(extractProject("add a task to Aivaura call the bank", KNOWN)).toEqual({ project: "Aivaura", rest: "call the bank" });
    expect(extractProject("ship the report for the Vector project", KNOWN)).toEqual({ project: "Vector", rest: "ship the report" });
    expect(extractProject("in Vector review the pull requests", KNOWN)).toEqual({ project: "Vector", rest: "review the pull requests" });
    expect(extractProject("Vector project: write the spec", KNOWN)).toEqual({ project: "Vector", rest: "write the spec" });
    expect(extractProject("order tiles under the Home Renovation project", KNOWN)).toEqual({ project: "Home Renovation", rest: "order tiles" });
    expect(extractProject("add task to drac post on linkedin", KNOWN)).toEqual({ project: "DRAC", rest: "post on linkedin" });
  });

  it("does not mistake an ordinary word for a project", () => {
    expect(extractProject("Vector insights dashboard review", KNOWN).project).toBeNull(); // a name inside a title, no preposition
    expect(extractProject("call the bank in the morning", KNOWN).project).toBeNull();
    expect(extractProject("write to the team about the offsite", KNOWN).project).toBeNull();
  });

  it("creates a new project only when you call it a project", () => {
    expect(extractProject("add a task for the Solar Panels project call the installer", KNOWN)).toEqual({ project: "Solar Panels", rest: "call the installer" });
    expect(extractProject("call the installer for solar panels", KNOWN).project).toBeNull();
  });

  it("turns a spoken task into a line the quick-add bar understands, project included", () => {
    expect(voiceToQuickAdd("add task to Aivaura call the bank tomorrow at 5 pm estimate 30 minutes", KNOWN)).toBe("Aivaura: call the bank @tom @5pm ~30m");
    expect(voiceToQuickAdd("must do ship the report for the Vector project on friday", KNOWN)).toBe("Vector: !! ship the report @fri");
    const p = parseQuickAdd("Vector: !! ship the report @fri", ctx);
    expect([p.project, p.title, p.mustDo]).toEqual(["Vector", "ship the report", true]);
    // without projects it behaves exactly as before
    expect(voiceToQuickAdd("Vector insights must do tomorrow at 5 pm estimate 2 hours")).toBe("Vector insights !! @tom @5pm ~2h");
  });

  it("the parser then files it under that project", () => {
    const p = parseQuickAdd(voiceToQuickAdd("add task to Aivaura call the bank tomorrow", KNOWN), ctx);
    expect(p.project).toBe("Aivaura");
    expect(p.title).toBe("call the bank");
  });
});

describe("the project picker in the quick-add bar", () => {
  it("aims, re-aims and clears a project without touching the rest of the line", () => {
    expect(withProject("call the bank @tom", "Aivaura")).toBe("Aivaura: call the bank @tom");
    expect(withProject("Aivaura: call the bank @tom", "Vector")).toBe("Vector: call the bank @tom");
    expect(withProject("Vector: call the bank", null)).toBe("call the bank");
    expect(currentProject("Vector: call the bank")).toBe("Vector");
    expect(currentProject("call the bank at 5:30pm")).toBeNull();
  });
});
