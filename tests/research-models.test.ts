// Research uses the strongest free model the key can reach: Pro first (when Google offers it), then Flash.
import { describe, expect, it } from "vitest";
import { pickGeminiModels, pickGeminiPro } from "@/lib/sales/gemini-models";

const m = (name: string) => ({ name: `models/${name}`, supportedGenerationMethods: ["generateContent"] });

describe("research models", () => {
  it("picks stable Pro models, newest first, and never previews", () => {
    const list = [m("gemini-2.5-pro"), m("gemini-3.1-pro"), m("gemini-3.1-pro-preview"), m("gemini-2.5-flash"), m("gemini-3.5-flash"), m("gemini-3.5-flash-lite")];
    expect(pickGeminiPro(list)).toEqual(["gemini-3.1-pro", "gemini-2.5-pro"]);
    // everyday use stays on Flash
    expect(pickGeminiModels(list)).toEqual(["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"]);
  });
});
