// House rule, enforced: no em dash or en dash anywhere in the app's code, prompts, drafts or stored text.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { one, q } from "@/lib/db";
import { chatWithModel } from "@/lib/ai";
import { channelUrl } from "@/lib/sales/links";
import { llm, llmJson } from "@/lib/sales/llm";
import { LONG_DASH, NO_DASH_RULE, noDashes, noDashesDeep } from "@/lib/text/no-dashes";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const ANY = /[\u2012-\u2015\u2E3A\u2E3B\uFE58]/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("noDashes", () => {
  it("turns every kind of long dash into plain punctuation", () => {
    expect(noDashes(`Quick question ${EM} are you free?`)).toBe("Quick question, are you free?");
    expect(noDashes(`Quick question${EM}are you free?`)).toBe("Quick question-are you free?");
    expect(noDashes(`We help clinics ${EM} like yours ${EM} book more.`)).toBe("We help clinics, like yours, book more.");
    expect(noDashes(`Open 10${EN}12, Mon${EN}Fri, 2 ${EN} 3 pm`)).toBe("Open 10-12, Mon-Fri, 2-3 pm");
    expect(noDashes(`${EM} first\n${EN} second`)).toBe("- first\n- second");
    expect(noDashes(`Thanks ${EM}\nAkshat`)).toBe("Thanks\nAkshat");
    expect(noDashes(`Price ${EM}.`)).toBe("Price.");
    expect(noDashes(`(${EM} aside)`)).toBe("(aside)");
    for (const ch of [0x2012, 0x2013, 0x2014, 0x2015, 0x2e3a, 0x2e3b, 0xfe58]) {
      expect(ANY.test(noDashes(`a ${String.fromCharCode(ch)} b`))).toBe(false);
    }
    expect(noDashes("plain - hyphen stays")).toBe("plain - hyphen stays");
    expect(noDashes(null)).toBeNull();
  });

  it("cleans nested AI answers", () => {
    const v = noDashesDeep({ a: `x ${EM} y`, b: [`p ${EN} q`, 3], c: { d: `${EM} z` } });
    expect(JSON.stringify(v)).not.toMatch(ANY);
    expect(v.b[1]).toBe(3);
  });
});

describe("the AI never gets to use one", () => {
  const answer = (text: string) =>
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
    });
  let calls: { messages: { role: string; content: unknown }[] }[] = [];

  it("sales AI: every prompt carries the rule and every answer is cleaned", async () => {
    calls = [];
    vi.stubEnv("GEMINI_API_KEY", "test");
    vi.stubGlobal("fetch", answer(`Hi Ravi ${EM} saw your clinic ${EM} quick idea.`));
    const r = await llm([{ role: "user", content: "write a first message" }]);
    expect(r.text).toBe("Hi Ravi, saw your clinic, quick idea.");
    expect(JSON.stringify(calls[0].messages)).toContain(NO_DASH_RULE);
    vi.stubGlobal("fetch", answer(JSON.stringify({ message: `Hello ${EM} there`, subject: `Re ${EN} demo` })));
    const j = await llmJson<{ message: string; subject: string }>("draft", "x");
    expect(JSON.stringify(j)).not.toMatch(ANY);
  });

  it("assistant and Telegram AI: same", async () => {
    calls = [];
    vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.stubGlobal("fetch", answer(`Done ${EM} moved it to Friday.`));
    const r = await chatWithModel([{ role: "system", content: "You help." }, { role: "user", content: "move it" }]);
    expect(r.text).toBe("Done, moved it to Friday.");
    expect(String(calls[0].messages[0].content)).toContain(NO_DASH_RULE);
  });

  it("a message leaving through WhatsApp or email is cleaned, whoever wrote it", () => {
    const wa = decodeURIComponent(channelUrl("whatsapp", { phone: "+919820011111" }, `Hi ${EM} following up`)!);
    expect(wa).not.toMatch(ANY);
    expect(wa).toContain("Hi, following up");
    const mail = decodeURIComponent(channelUrl("email", { email: "a@b.co" }, `Body ${EN} text`, `Subject ${EM} x`)!);
    expect(mail).not.toMatch(ANY);
  });
});

describe("stored text", () => {
  it("the clean-up function in the database follows the same rules", async () => {
    const r = await one<{ a: string; b: string; c: string }>(
      "select no_long_dashes($1) as a, no_long_dashes($2) as b, no_long_dashes($3, true) as c",
      [`Hi ${EM} there\n${EM} item`, `10${EN}12`, JSON.stringify({ x: `a ${EM} b` })],
    );
    expect(r).toEqual({ a: "Hi, there\n- item", b: "10-12", c: JSON.stringify({ x: "a, b" }) });
    await q("select 1");
  });
});

describe("the code itself", () => {
  it("has no long dash in any tracked file (code, prompts, seeds, docs, tests)", () => {
    const root = path.resolve(__dirname, "..");
    const files = execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
    const bad: string[] = [];
    for (const f of files) {
      if (/\.(png|jpe?g|gif|ico|webp|pdf|docx|woff2?|ttf|zip)$/i.test(f)) continue;
      const p = path.join(root, f);
      if (!fs.existsSync(p)) continue;
      const s = fs.readFileSync(p, "utf8");
      s.split("\n").forEach((line, i) => {
        if (LONG_DASH.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
