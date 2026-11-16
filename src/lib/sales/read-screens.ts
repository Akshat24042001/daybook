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

export interface Owner { name: string; aliases: string[] }

/**
 * Who wrote each message is the part image models get wrong most. LinkedIn (desktop and most of mobile), email, group
 * chats and Instagram on desktop do not put your messages on the right: they put a name above each group of messages.
 * So the name shown decides; "You" labels next; the bubble side only when neither is shown.
 */
export function readPrompt(owner?: Owner | null): string {
  const names = owner ? [owner.name, ...owner.aliases.filter((a) => !/^(you|me)$/i.test(a))] : [];
  return `Write out everything readable in this screenshot as plain text. Do not summarise, do not add anything.
${owner ? `\nTHE PHONE / ACCOUNT OWNER is ${owner.name}${names.length > 1 ? ` (also shown as: ${[...new Set(names.slice(1))].join(", ")})` : ""}. Messages written by the owner are ME. Everyone else is THEM.\n` : ""}
If it is a chat (WhatsApp, LinkedIn, Instagram, SMS, Telegram, email thread):
- First line: CHAT WITH: <the other person's name or number at the top of the chat>, APP: <which app it looks like>
- Second line, only if visible: STATUS BAR: <the time and date shown in the phone's status bar or the computer's clock>
- Then one line per message, oldest first:
  [date and time if shown] ME (<name shown, or "no name shown">): <text>
  [date and time if shown] THEM (<name shown, or "no name shown">): <text>
- DECIDE WHO WROTE EACH MESSAGE IN THIS ORDER:
  1. A sender name shown above or beside the message. On LinkedIn every message group starts with the sender's name and
     photo, and all messages after it belong to that sender until the next name. If that name is ${owner ? owner.name : "the owner's"}${names.length > 1 ? ` or ${names.slice(1).join(" or ")}` : ""}, it is ME; any other name is THEM.
  2. A "You", "You:", "You sent", "Sent" or tick marks label means ME.
  3. Only when no name or label is shown: right side (usually green or blue bubbles) is ME, left side is THEM.
  Never decide by what the message says. If you truly cannot tell, write UNSURE (<name shown>) instead of ME or THEM.
- Keep date separators ("Today", "Yesterday", "Monday", "12 March") as their own lines in square brackets, exactly as shown.
- Copy each message's time exactly as shown (for example 10:42 am). Never add a time or date that is not on the screen.
- Write "[image]", "[voice note 0:42]", "[document: name.pdf]", "[link preview: title, domain]" for media.

If it is an email: FROM, TO, DATE, SUBJECT lines, then the body.
If it is a profile, card, post or anything else: every name, title, company, phone number, email, link and the text.

Copy numbers, emails, names, company names and website addresses exactly as shown (a link someone shares is important).
If part of it cannot be read, write [unreadable].`;
}

export interface ScreenRead {
  text: string;
  model: string;
}

/** Reads each screenshot into text. Two at a time; a screenshot no model can read is named in the error. */
export async function readScreens(images: string[], totalMs = 40_000, owner?: Owner | null): Promise<ScreenRead[]> {
  const prompt = readPrompt(owner);
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
          [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: images[i] } }] }],
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
