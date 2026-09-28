/**
 * The live list of free models on OpenRouter. Free IDs come and go, so the list is fetched (the catalogue endpoint
 * is public) and cached for an hour instead of being hardcoded.
 */
import { openModels } from "../ai";
import type { FreeModel } from "./types";

interface OrModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  created?: number;
  pricing?: { prompt?: string; completion?: string; request?: string };
  top_provider?: { max_completion_tokens?: number | null; context_length?: number | null };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

let cache: { at: number; models: FreeModel[] } | null = null;
const TTL = 60 * 60 * 1000;

const isZero = (v: string | undefined) => v === undefined || Number(v) === 0;

export function toFreeModels(data: OrModel[], recommended: string[]): FreeModel[] {
  const rec = new Set(recommended);
  return data
    // only the official free variants: zero-priced ids without ":free" are mostly "stealth" test models, which log
    // prompts, and this assistant sends the owner's whole life to the model
    .filter((m) => m.id.endsWith(":free") && isZero(m.pricing?.prompt) && isZero(m.pricing?.completion))
    // the assistant needs a text-only chat model: no music/image generators, no safety classifiers
    .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.every((o) => o === "text"))
    .filter((m) => !/(content-safety|guard|moderation|embed)/i.test(m.id))
    .filter((m) => !m.id.startsWith("openrouter/") && !m.id.startsWith("stealth/"))
    .map((m): FreeModel => {
      const params = new Set(m.supported_parameters ?? []);
      const name = (m.name ?? m.id).replace(/\s*\(free\)\s*$/i, "");
      return {
        id: m.id,
        name,
        provider: m.id.split("/")[0],
        context: m.context_length ?? m.top_provider?.context_length ?? 0,
        maxOutput: m.top_provider?.max_completion_tokens ?? null,
        created: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null,
        tools: params.has("tools"),
        reasoning: params.has("reasoning") || params.has("include_reasoning"),
        structured: params.has("structured_outputs") || params.has("response_format"),
        description: (m.description ?? "").replace(/\s+/g, " ").slice(0, 400),
        recommended: rec.has(m.id),
      };
    })
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.context - a.context || a.name.localeCompare(b.name));
}

export async function freeModels(force = false): Promise<FreeModel[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.models;
  const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new Error(`OpenRouter models ${res.status}`);
  const json = (await res.json()) as { data?: OrModel[] };
  const models = toFreeModels(json.data ?? [], openModels());
  cache = { at: Date.now(), models };
  return models;
}
