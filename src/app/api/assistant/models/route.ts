import { freeModels } from "@/lib/assistant/models";

export const dynamic = "force-dynamic";

/** Free OpenRouter models for the assistant's model picker. Behind the login like every /api route. */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.has("refresh");
  try {
    return Response.json({ ok: true, models: await freeModels(force) });
  } catch (e) {
    console.error("[assistant] model list failed:", (e as Error).message);
    return Response.json({ ok: false, error: "Could not load the model list from OpenRouter.", models: [] }, { status: 502 });
  }
}
