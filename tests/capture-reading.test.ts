// Screenshots are read in two steps (image model writes it out, text models file it), failures keep the capture for a
// retry, and every filing leaves a summary, quick actions and a reply on the deal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { one, q } from "@/lib/db";
import { doneQuickAction, summarizeDeal } from "@/lib/sales/conversation";
import { createDeal, getDeal, logActivity } from "@/lib/sales/deals";
import { capture, cleanQuickActions, processCapture } from "@/lib/sales/ingest";
import { quickActionAction, retryCaptureAction } from "@/app/sales-actions";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";

const filing = {
  kind: "conversation", is_sales_related: true, channel: "whatsapp", direction: "both",
  people: [{ name: "Ravi Shah", company: "Shah Dental", phone: "+91 98200 11111" }],
  company: { name: "Shah Dental" },
  messages: [
    { from: "them", at: "2026-11-10T10:00:00Z", text: "Can the bot book appointments for 3 branches?" },
    { from: "me", at: "2026-11-10T10:05:00Z", text: "Yes. I will send a proposal by Friday." },
    { from: "them", at: "2026-11-11T09:00:00Z", text: "Great, what would it cost?" },
  ],
  summary: "Ravi wants a booking bot for 3 branches and asked the price.",
  deal_summary: "Shah Dental wants a WhatsApp booking bot for 3 branches. Proposal promised by Friday. They asked the price.",
  commitments: [{ owner: "me", text: "send the proposal", due: "2026-11-14" }],
  next_step: "Send the proposal with the price",
  quick_actions: [
    { kind: "reply", label: "Answer the price question", detail: "give the range for 3 branches", due: null },
    { kind: "send", label: "Send the proposal", detail: null, due: "2026-11-14" },
    { kind: "stage", label: "Move to Proposal", stage: "proposal" },
    { kind: "nonsense", label: "ignored" },
  ],
  reply_draft: "Hi Ravi, for 3 branches it is around 2 lakh. Sending the full proposal by Friday.",
};

/** A scripted AI: answers image requests with `read`, text requests with the filing; records what was asked. */
function scriptedAi(o: { read?: string | ((model: string) => Response); file?: unknown } = {}) {
  const calls: { model: string; vision: boolean; prompt: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model: string; messages: { role: string; content: unknown }[] };
    const vision = JSON.stringify(body.messages).includes("image_url");
    calls.push({ model: body.model, vision, prompt: JSON.stringify(body.messages) });
    if (vision && typeof o.read === "function") return o.read(body.model);
    const content = vision ? (o.read ?? "CHAT WITH: Ravi Shah\n[10 Nov 15:30] THEM: Can the bot book appointments for 3 branches?") : JSON.stringify(o.file ?? filing);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }));
  return calls;
}

beforeEach(async () => {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_jobs restart identity cascade`);
  await q("update sales_settings set config = '{}'::jsonb");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.stubEnv("AI_VISION_MODELS", "acme/vision-a:free,mistralai/mistral-small:free");
  vi.stubEnv("AI_MODELS", "acme/text-a:free");
  (globalThis as unknown as { __llmCool?: Map<string, number> }).__llmCool?.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("reading a screenshot", () => {
  it("reads the picture with the image model, files from the text with the text model, and keeps the text", async () => {
    const calls = scriptedAi();
    const id = await capture({ source: "web", text: "", images: [IMG] }, { now: true });
    const r = await processCapture(id);
    const read = calls.filter((c) => c.vision);
    const file = calls.filter((c) => !c.vision);
    expect(read).toHaveLength(1);
    expect(read[0].model).toBe("acme/vision-a:free");
    expect(read[0].prompt).toContain("Write out everything readable");
    expect(read[0].prompt).not.toContain("is_sales_related"); // the image model never sees the long filing instructions
    expect(file).toHaveLength(1);
    expect(file[0].model).toBe("acme/text-a:free");
    expect(file[0].prompt).toContain("SCREENSHOT TEXT");
    expect(file[0].prompt).toContain("Can the bot book appointments");
    expect(r.deal_id).toBeTruthy();
    expect(r.messages).toHaveLength(3);
    expect((await one<{ screen_text: string }>("select screen_text from sales_captures where id = $1", [id]))!.screen_text).toContain("CHAT WITH: Ravi Shah");
    // the deal carries the whole picture: summary, quick actions (checked), the reply
    const d = (await one<{ summary: string; conversation: { quick_actions: { kind: string }[]; reply_draft: string } }>("select summary, conversation from sales_deals where id = $1", [r.deal_id]))!;
    expect(d.summary).toContain("Proposal promised by Friday");
    expect(d.conversation.quick_actions.map((a) => a.kind)).toEqual(["reply", "send", "stage"]);
    expect(d.conversation.reply_draft).toContain("around 2 lakh");
    expect(r.quick_actions).toHaveLength(3);
  });

  it("when a model like Mistral fails, the next one reads it; a failed model is not tried first again", async () => {
    const calls = scriptedAi({
      read: (model) => (model.startsWith("acme/")
        ? new Response("{\"error\":{\"message\":\"Provider returned error\"}}", { status: 400 })
        : new Response(JSON.stringify({ choices: [{ message: { content: "THEM: hello, price?" } }] }), { status: 200 })),
    });
    const id = await capture({ source: "web", text: "", images: [IMG] }, { now: true });
    await processCapture(id);
    expect(calls.filter((c) => c.vision).map((c) => c.model)).toEqual(["acme/vision-a:free", "mistralai/mistral-small:free"]);
    calls.length = 0;
    const id2 = await capture({ source: "web", text: "", images: [IMG] }, { now: true });
    await processCapture(id2);
    expect(calls.filter((c) => c.vision)[0].model).toBe("mistralai/mistral-small:free");
  });

  it("when no model can read it, the capture is kept with a clear message, and a retry does not read again", async () => {
    scriptedAi({ read: () => new Response("bad image", { status: 400 }) });
    const id = await capture({ source: "web", text: "", images: [IMG] }, { now: true });
    await expect(processCapture(id)).rejects.toThrow(/Could not read the screenshot.*GEMINI_API_KEY/);
    expect((await one<{ status: string; error: string }>("select status, error from sales_captures where id = $1", [id]))).toMatchObject({ status: "failed" });

    // read once, then the filing failed: the retry only files
    await q("update sales_captures set screen_text = 'THEM: Can the bot book appointments for 3 branches?' where id = $1", [id]);
    const calls = scriptedAi();
    const r = await retryCaptureAction(id);
    expect(r.ok && r.result.deal_id).toBeTruthy();
    expect(calls.filter((c) => c.vision)).toHaveLength(0);
  });
});

describe("summary and quick actions", () => {
  it("rebuilds the summary from every touch and offers next steps", async () => {
    const deal = await createDeal({ title: "Shah Dental", source: "inbound" });
    await logActivity(deal, { type: "whatsapp", body: "They asked for the price for 3 branches", direction: "in" });
    await logActivity(deal, { type: "call", body: "Call: they want it live before Diwali", direction: "both" });
    const calls = scriptedAi({ file: { summary: "Wants a bot for 3 branches before Diwali; waiting on price.", quick_actions: filing.quick_actions, reply_draft: "Price is around 2 lakh." } });
    const s = await summarizeDeal(deal);
    expect(calls[0].prompt).toContain("before Diwali");
    expect(s.summary).toContain("Diwali");
    expect((await getDeal(deal))!.summary).toContain("Diwali");
    expect(s.conversation.quick_actions).toHaveLength(3);
  });

  it("does a quick action in one click: next step with its date, or a promise; dismissing just hides it", async () => {
    const deal = await createDeal({ title: "Shah Dental", source: "inbound" });
    await q("update sales_deals set conversation = $2 where id = $1", [deal, JSON.stringify({ quick_actions: cleanQuickActions(filing.quick_actions), reply_draft: null, at: new Date().toISOString() })]);
    expect((await quickActionAction(deal, 1, { kind: "send", label: "Send the proposal", due: "2026-11-14" })).ok).toBe(true);
    const d = (await one<{ next_action: string; next_action_at: string; conversation: { done: number[] } }>("select next_action, next_action_at, conversation from sales_deals where id = $1", [deal]))!;
    expect(d.next_action).toBe("Send the proposal");
    expect(new Date(d.next_action_at).toISOString().slice(0, 10)).toBe("2026-11-14");
    expect(d.conversation.done).toEqual([1]);
    await quickActionAction(deal, 0, { kind: "promise", label: "Share pricing", due: "2026-11-15" });
    expect(await one("select 1 from sales_commitments where deal_id = $1 and text = 'Share pricing' and owner = 'me'", [deal])).toBeTruthy();
    await doneQuickAction(deal, 2);
    expect((await one<{ c: { done: number[] } }>("select conversation as c from sales_deals where id = $1", [deal]))!.c.done.sort()).toEqual([0, 1, 2]);
  });

  it("keeps only sensible quick actions", () => {
    expect(cleanQuickActions(null)).toEqual([]);
    expect(cleanQuickActions([{ kind: "stage", label: "x", stage: "flying" }, { kind: "call", label: " Call Ravi ", due: "Friday" }]))
      .toEqual([{ kind: "call", label: "Call Ravi", detail: null, due: null, stage: null }]);
  });
});
