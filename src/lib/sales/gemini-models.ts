/**
 * Which Gemini models to use, from Google's own list for your key, so a retired model never breaks anything.
 * Flash models first (fast, generous free tier), newest version first, then Flash-Lite. Pro is left out: its free
 * tier is too small for this. GEMINI_MODELS (or GEMINI_SEARCH_MODELS for research) still overrides it.
 */
const FALLBACK = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"];
const TTL = 6 * 60 * 60 * 1000;
const store = ((globalThis as unknown as { __geminiModels?: { at: number; list: string[] } | null }).__geminiModels ??= null);
let cache: { at: number; list: string[] } | null = store;

const version = (id: string) => Number(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);

/** Picks the usable chat models out of Google's list, best first. Pure, for tests. */
export function pickGeminiModels(models: { name: string; supportedGenerationMethods?: string[] }[]): string[] {
  const ids = models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((id) => /^gemini-[\d.]+-flash(-lite)?$/.test(id)); // stable Flash and Flash-Lite only: no preview, exp, tts, image, live
  const flash = ids.filter((id) => !id.endsWith("-lite")).sort((a, b) => version(b) - version(a));
  const lite = ids.filter((id) => id.endsWith("-lite")).sort((a, b) => version(b) - version(a));
  return [...flash.slice(0, 2), ...lite.slice(0, 1)];
}

export async function geminiModels(envVar: "GEMINI_MODELS" | "GEMINI_SEARCH_MODELS" = "GEMINI_MODELS"): Promise<string[]> {
  const env = (process.env[envVar] ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  if (env.length) return env;
  if (cache && Date.now() - cache.at < TTL) return cache.list;
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return FALLBACK;
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(8_000), cache: "no-store",
    });
    if (!res.ok) throw new Error(`models ${res.status}`);
    const json = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const list = pickGeminiModels(json.models ?? []);
    cache = { at: Date.now(), list: list.length ? list : FALLBACK };
  } catch {
    cache = { at: Date.now() - TTL + 10 * 60_000, list: FALLBACK }; // try the list again in 10 minutes
  }
  (globalThis as unknown as { __geminiModels?: typeof cache }).__geminiModels = cache;
  return cache.list;
}
