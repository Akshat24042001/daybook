import { aiConfigured } from "@/lib/ai";
import { askAssistant } from "@/lib/assistant/run";
import type { StreamEvent } from "@/lib/assistant/types";
import { UserError } from "@/lib/db";
import { cleanModel } from "@/lib/services/assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { chatId?: unknown; message?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return Response.json({ ok: false, error: "Ask something first." }, { status: 400 });
  if (message.length > 4000) return Response.json({ ok: false, error: "That is too long. Keep it under 4000 characters." }, { status: 400 });
  if (!aiConfigured()) {
    return Response.json({ ok: false, error: "The assistant needs OPENROUTER_API_KEY set on the server." }, { status: 503 });
  }

  const started = Date.now();
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => {
        try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } catch { /* client went away */ }
      };
      try {
        const r = await askAssistant({
          chatId: typeof body.chatId === "number" ? body.chatId : null,
          message,
          // the picker's choice travels with every message
          model: "model" in body ? cleanModel(body.model) : undefined,
          source: "web",
          deadline: started + 56_000,
          onChat: (chat) => send({ t: "chat", chatId: chat.id, title: chat.title }),
          onStatus: (text) => send({ t: "status", text }),
          onQuery: (step) => send({ t: "query", step }),
        });
        send({ t: "done", message: r.message, title: r.title, memoryChanged: r.memoryChanged });
      } catch (e) {
        console.error("[assistant] failed:", (e as Error).name, (e as Error).message);
        send({
          t: "error",
          error: e instanceof UserError ? e.message
            : /OpenRouter|model/i.test((e as Error).message) ? "The AI models are busy or unreachable right now. Try again in a minute."
              : "Something went wrong. Try again.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
