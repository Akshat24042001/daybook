import { aiConfigured } from "@/lib/ai";
import { runAgent, type AgentTurn } from "@/lib/assistant/agent";
import type { Block, StreamEvent } from "@/lib/assistant/types";
import { q } from "@/lib/db";
import { makeCtx, type Ctx } from "@/lib/settings";
import {
  addMemory, addMessage, cleanModel, createChat, deleteMemory, getChat, listMemory, messagesFor, renameChat, setChatModel,
} from "@/lib/services/assistant";
import { addDays } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A few live numbers so everyday questions ("how's today going?") need fewer round trips. */
async function snapshot(ctx: Ctx): Promise<string> {
  try {
    const [days, tasks, state] = await Promise.all([
      q<Record<string, unknown>>(
        `select date, worked_min, logged_min, planned, done, still_open, must_do, must_do_done, ex_done, ex_missed, steps, score, sleep_minutes
         from v_daily where date in ($1, $2) order by date desc`,
        [ctx.today, addDays(ctx.today, -1)],
      ),
      q<{ active: number; overdue: number; rotting: number; waiting: number; someday: number }>(
        `select count(*) filter (where type <> 'someday')::int as active,
                count(*) filter (where due_date < $1 and type <> 'someday')::int as overdue,
                count(*) filter (where carry_count >= (select rot_threshold from settings where id = 1) and type <> 'someday')::int as rotting,
                count(*) filter (where waiting_until is not null)::int as waiting,
                count(*) filter (where type = 'someday')::int as someday
         from tasks where state = 'active'`,
        [ctx.today],
      ),
      q<{ kind: string; since: string }>(
        `select kind, to_char(start_at at time zone $1, 'HH24:MI') as since from work_segments where end_at is null order by start_at desc limit 1`,
        [ctx.tz],
      ),
    ]);
    const line = (r: Record<string, unknown>) =>
      `${r.date}: worked ${Math.round(Number(r.worked_min) / 6) / 10}h, logged ${Math.round(Number(r.logged_min) / 6) / 10}h, ` +
      `tasks done ${r.done}/${r.planned} (${r.still_open} still open), must-do ${r.must_do_done}/${r.must_do}, ` +
      `exercise ${r.ex_done} done ${r.ex_missed} missed, steps ${r.steps ?? "–"}, score ${r.score ?? "–"}, sleep ${r.sleep_minutes ?? "–"} min`;
    const t = tasks[0];
    return [
      ...days.map(line),
      t ? `Active tasks: ${t.active} (overdue ${t.overdue}, rotting ${t.rotting}, waiting ${t.waiting}); someday pool ${t.someday}.` : "",
      state[0] ? `Current state: ${state[0].kind} since ${state[0].since}.` : "Current state: off (no running segment).",
    ].filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

/** Earlier turns as the model sees them: the text, plus a note of what was shown alongside it. */
function historyOf(messages: { role: "user" | "assistant"; content: string; blocks: Block[] }[]): AgentTurn[] {
  return messages.slice(-12).map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    const shown = m.blocks
      .map((b) => (b.type === "chart" ? `[chart: ${b.title}]` : b.type === "table" ? `[table: ${b.title}, ${b.total ?? b.rows.length} rows]` : ""))
      .filter(Boolean)
      .join(" ");
    return { role: "assistant", content: `${m.content.slice(0, 3000)}${shown ? `\n${shown}` : ""}` };
  });
}

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
        const ctx = await makeCtx();
        const existing = typeof body.chatId === "number" ? await getChat(body.chatId) : null;
        // the picker's choice travels with every message; an existing chat takes it on if it changed
        const picked = "model" in body ? cleanModel(body.model) : undefined;
        const chat = existing ?? (await createChat(message, picked ?? null));
        if (existing && picked !== undefined && picked !== existing.model) {
          await setChatModel(existing.id, picked);
          chat.model = picked;
        }
        send({ t: "chat", chatId: chat.id, title: chat.title });

        const prior = await messagesFor(chat.id);
        await addMessage(chat.id, { role: "user", content: message });
        const [memory, snap] = await Promise.all([listMemory(), snapshot(ctx)]);

        const result = await runAgent({
          ctx,
          question: message,
          history: historyOf(prior),
          memory,
          snapshot: snap,
          deadline: started + 56_000,
          prefer: chat.model,
          emit: {
            status: (text) => send({ t: "status", text }),
            query: (step) => send({ t: "query", step }),
          },
        });

        let memoryChanged = false;
        if (result.remember.length) memoryChanged = (await addMemory(result.remember, chat.id)) > 0 || memoryChanged;
        if (result.forget.length) memoryChanged = (await deleteMemory(result.forget)) > 0 || memoryChanged;

        const saved = await addMessage(chat.id, {
          role: "assistant",
          content: result.content,
          blocks: result.blocks,
          steps: result.steps,
          model: result.model,
        });
        let title: string | undefined;
        if (!prior.length && result.title) {
          await renameChat(chat.id, result.title);
          title = result.title;
        }
        send({ t: "done", message: saved, title, memoryChanged });
      } catch (e) {
        console.error("[assistant] failed:", (e as Error).name, (e as Error).message);
        send({ t: "error", error: /OpenRouter|model/i.test((e as Error).message) ? "The AI models are busy or unreachable right now. Try again in a minute." : "Something went wrong. Try again." });
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
