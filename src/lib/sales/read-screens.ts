/**
 * Step one of filing a screenshot: read it into plain text.
 *
 * Asking a free image model to fill the whole filing JSON from a picture fails often (small models such as Mistral
 * lose the long instructions or the JSON). So the image model only writes out what is on the screen, one screenshot
 * at a time, and the stronger text models do the filing from that text. The text is kept on the capture, so a retry
 * does not read the pictures again.
 */
import { llm, llmConfigured } from "./llm";
import { UserError } from "../db";

const READ_PROMPT = `Write out everything readable in this screenshot as plain text. Do not summarise, do not add anything.

If it is a chat (WhatsApp, LinkedIn, Instagram, SMS, Telegram):
- First line: CHAT WITH: <the name or number at the top of the chat>, APP: <which app it looks like>
- Then one line per message, oldest first, in this form:
  [date and time if shown] ME: <text>     for messages on the RIGHT side (the phone owner, usually green or blue bubbles)
  [date and time if shown] THEM: <text>   for messages on the LEFT side
- Keep date separators ("Yesterday", "12 March") as their own lines in square brackets.
- Write "[image]", "[voice note 0:42]", "[document: name.pdf]" for media.

If it is an email: FROM, TO, DATE, SUBJECT lines, then the body.
If it is a profile, card, post or anything else: every name, title, company, phone number, email, link and the text.

Copy numbers, emails and names exactly. If part of it cannot be read, write [unreadable].`;

export interface ScreenRead {
  text: string;
  model: string;
}

/** Reads each screenshot into text. Two at a time; a screenshot no model can read is named in the error. */
export async function readScreens(images: string[], totalMs = 40_000): Promise<ScreenRead[]> {
  if (!images.length) return [];
  if (!llmConfigured()) throw new UserError("Reading screenshots needs an AI key: add GEMINI_API_KEY (free, best for images) or OPENROUTER_API_KEY.");
  const out: (ScreenRead | Error)[] = new Array(images.length);
  let next = 0;
  const deadline = Date.now() + totalMs;
  const worker = async () => {
    while (next < images.length) {
      const i = next++;
      try {
        const r = await llm(
          [{ role: "user", content: [{ type: "text", text: READ_PROMPT }, { type: "image_url", image_url: { url: images[i] } }] }],
          { vision: true, temperature: 0, maxTokens: 3000, totalMs: Math.max(8_000, deadline - Date.now()) },
        );
        const text = r.text.replace(/^```\w*\s*|```\s*$/g, "").trim();
        if (!text) throw new Error("empty read");
        out[i] = { text, model: r.model };
      } catch (e) {
        out[i] = e as Error;
      }
    }
  };
  await Promise.all([worker(), worker()]);
  const failed = out.map((r, i) => (r instanceof Error ? i + 1 : 0)).filter(Boolean);
  if (failed.length === images.length) {
    const why = (out[0] as Error).message;
    throw new UserError(
      `Could not read the screenshot${images.length > 1 ? "s" : ""}: no image-reading AI answered${why ? ` (${why.slice(0, 120)})` : ""}. ` +
      (process.env.GEMINI_API_KEY ? "Try again in a minute, or paste the text instead." : "Add a free GEMINI_API_KEY for reliable screenshot reading, or paste the text instead."),
    );
  }
  return out.map((r, i) => (r instanceof Error ? { text: `[screenshot ${i + 1} could not be read]`, model: "" } : r));
}

/** The screenshots' text, ready to put in front of the filing step. */
export function screensAsText(reads: ScreenRead[]): string {
  return reads.map((r, i) => (reads.length > 1 ? `--- SCREENSHOT ${i + 1} ---\n${r.text}` : r.text)).join("\n\n");
}
