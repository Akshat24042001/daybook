/**
 * The Sales AI client. Free providers only:
 *   1. Google Gemini free tier (GEMINI_API_KEY), best for screenshots, long transcripts and JSON;
 *   2. the free OpenRouter models Daybook already uses (OPENROUTER_API_KEY).
 * A request walks the providers and models until one answers. Images are sent as data URLs.
 */
import { noDashes, withNoDashRule } from "../text/no-dashes";
import { openModels } from "../ai";
import { freeModels } from "../assistant/models";
import { geminiModels } from "./gemini-models";

export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | Part[];
}

export interface LlmOptions {
  maxTokens?: number;
  temperature?: number;
  /** total time budget across every fallback */
  totalMs?: number;
  /** needs a model that can read images */
  vision?: boolean;
  /** skip Gemini (used when the caller already tried it) */
  noGemini?: boolean;
}

const VISION_FALLBACK = [
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-4-maverick:free",
  "qwen/qwen2.5-vl-72b-instruct:free",
  "mistralai/mistral-small-3.2-24b-instruct:free",
];

export function llmConfigured(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY);
}

interface Target {
  url: string;
  key: string;
  model: string;
  extra?: Record<string, unknown>;
  /** spends part of max_tokens on thinking */
  thinks?: boolean;
}

// a model that just failed is skipped for a while, so the next request does not wait on it again
const cool = ((globalThis as unknown as { __llmCool?: Map<string, number> }).__llmCool ??= new Map<string, number>());
const COOL_MS = 10 * 60_000;
const cooling = (model: string) => (cool.get(model) ?? 0) > Date.now();

/** Image-reading order: families that read screenshots well first, Mistral last (it struggles with long prompts). */
const VISION_RANK = [/gemini|gemma/i, /qwen/i, /llama-4/i, /nvidia|nemotron/i];
const rank = (id: string) => (/mistral|pixtral/i.test(id) ? 99 : ((i) => (i < 0 ? 50 : i))(VISION_RANK.findIndex((r) => r.test(id))));

/** Free models that read images: your list (AI_VISION_MODELS), else the live OpenRouter catalogue, else a fixed list. */
export async function visionModels(): Promise<string[]> {
  const env = (process.env.AI_VISION_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  if (env.length) return env;
  const live = await freeModels().then((ms) => ms.filter((m) => m.vision).map((m) => m.id)).catch(() => [] as string[]);
  const list = [...new Set([...live, ...VISION_FALLBACK])];
  return list.sort((a, b) => rank(a) - rank(b)).slice(0, 6);
}

async function targets(o: LlmOptions): Promise<Target[]> {
  const out: Target[] = [];
  const gemini = o.noGemini ? "" : process.env.GEMINI_API_KEY?.trim();
  if (gemini) {
    for (const model of await geminiModels()) {
      // newer Gemini models think first: keep it short, and leave room for the thinking in the token allowance
      out.push({ url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: gemini, model, ...(/gemini-(1|2\.0)/.test(model) ? {} : { extra: { reasoning_effort: "low" }, thinks: true }) });
    }
  }
  const or = process.env.OPENROUTER_API_KEY?.trim();
  if (or) {
    const list = o.vision ? await visionModels() : openModels();
    for (const model of list) {
      out.push({
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: or,
        model,
        extra: { reasoning: { effort: "low", exclude: true } },
      });
    }
  }
  // models that failed in the last few minutes go last instead of first
  return [...out.filter((t) => !cooling(t.model)), ...out.filter((t) => cooling(t.model))];
}

async function once(t: Target, messages: LlmMessage[], o: LlmOptions, timeoutMs: number): Promise<string> {
  const res = await fetch(t.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${t.key}`,
      "HTTP-Referer": process.env.APP_BASE_URL ?? "https://daybook.app",
      "X-Title": "Daybook Sales",
    },
    body: JSON.stringify({
      model: t.model,
      messages: withNoDashRule(messages),
      temperature: o.temperature ?? 0.3,
      max_tokens: (o.maxTokens ?? 1200) + (t.thinks ? 2048 : 0),
      ...(t.extra ?? {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${t.model} ${res.status}: ${text.slice(0, 160)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const out = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!out) throw new Error(`${t.model}: empty answer`);
  return noDashes(out); // whatever the model wrote, no long dashes reach the app
}

export async function llm(messages: LlmMessage[], o: LlmOptions = {}): Promise<{ text: string; model: string }> {
  const list = await targets(o);
  if (!list.length) throw new Error("No AI key set: add GEMINI_API_KEY or OPENROUTER_API_KEY");
  const deadline = Date.now() + (o.totalMs ?? 45_000);
  let last: Error | null = null;
  for (const t of list) {
    const left = deadline - Date.now();
    if (left < 3_000) break;
    try {
      return { text: await once(t, messages, o, Math.min(30_000, left)), model: t.model };
    } catch (e) {
      last = e as Error;
      cool.set(t.model, Date.now() + COOL_MS);
      console.warn("[sales-ai] model failed:", last.message.slice(0, 140));
    }
  }
  throw last ?? new Error("No AI model answered");
}

/** Pulls the first JSON object or array out of a model answer (fences, prose and trailing commas tolerated). */
export function parseJson<T>(raw: string): T {
  let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  const open = s[0];
  const close = open === "[" ? "]" : "}";
  const end = s.lastIndexOf(close);
  if (end >= 0) s = s.slice(0, end + 1);
  try {
    return JSON.parse(s) as T;
  } catch {
    return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")) as T;
  }
}

/** Asks for JSON and parses it; one retry with a stricter reminder if the first answer does not parse. */
export async function llmJson<T>(system: string, user: string | Part[], o: LlmOptions = {}): Promise<T> {
  const messages: LlmMessage[] = [
    { role: "system", content: `${system}\n\nAnswer with ONE valid JSON value only. No markdown fences, no commentary.` },
    { role: "user", content: user },
  ];
  const first = await llm(messages, { temperature: 0.1, ...o });
  try {
    return parseJson<T>(first.text);
  } catch {
    const again = await llm(
      [...messages, { role: "assistant", content: first.text }, { role: "user", content: "That was not valid JSON. Send only the JSON value." }],
      { temperature: 0, ...o, totalMs: 25_000 },
    );
    return parseJson<T>(again.text);
  }
}

/** House style: no em or en dashes anywhere (see lib/text/no-dashes). */
export function stripDashes(s: string): string {
  return noDashes(s);
}
