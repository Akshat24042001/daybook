/**
 * One assistant turn, the same for the web page and Telegram: find or start the chat, save the question, run the
 * agent with a live snapshot and memory, turn proposed changes into stored action buttons, save the answer.
 */
import { q, UserError } from "../db";
import { makeCtx, type Ctx } from "../settings";
import {
  addMemory, addMessage, createChat, deleteMemory, getChat, listMemory, messagesFor, renameChat, setChatModel,
} from "../services/assistant";
import { addDays } from "../time";
import { prepareAction, proposeActions } from "./actions";
import { runAgent, type AgentTurn } from "./agent";
import type { Block, ChatSummary, MessageView, Step } from "./types";

/** A few live numbers so everyday questions ("how's today going?") need fewer round trips. */
export async function snapshot(ctx: Ctx): Promise<string> {
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
export function historyOf(messages: { role: "user" | "assistant"; content: string; blocks: Block[] }[]): AgentTurn[] {
  return messages.slice(-12).map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    const shown = m.blocks
      .map((b) =>
        b.type === "chart" ? `[chart: ${b.title}]`
          : b.type === "table" ? `[table: ${b.title}, ${b.total ?? b.rows.length} rows]`
            : b.type === "actions" ? `[buttons: ${b.items.map((i) => `${i.label} (${i.status})`).join("; ")}]`
              : "")
      .filter(Boolean)
      .join(" ");
    return { role: "assistant", content: `${m.content.slice(0, 3000)}${shown ? `\n${shown}` : ""}` };
  });
}

export interface AskResult {
  chat: ChatSummary;
  message: MessageView;
  /** set when this turn named a new chat */
  title?: string;
  memoryChanged: boolean;
}

export async function askAssistant(o: {
  chatId: number | null;
  message: string;
  /** undefined: keep the chat's model; null: automatic; string: this OpenRouter model */
  model?: string | null;
  source: "web" | "telegram";
  deadline: number;
  /** the moment the question was asked (Telegram passes the update's time); default: now */
  ctx?: Ctx;
  onChat?: (chat: ChatSummary) => void;
  onStatus?: (text: string) => void;
  onQuery?: (step: Step) => void;
}): Promise<AskResult> {
  const message = o.message.trim();
  if (!message) throw new UserError("Ask something first.");
  if (message.length > 4000) throw new UserError("That is too long. Keep it under 4000 characters.");
  const ctx = o.ctx ?? (await makeCtx());
  const existing = o.chatId ? await getChat(o.chatId) : null;
  const chat = existing ?? (await createChat(message, o.model ?? null, o.source));
  if (existing && o.model !== undefined && o.model !== existing.model) {
    await setChatModel(existing.id, o.model);
    chat.model = o.model;
  }
  o.onChat?.(chat);

  const prior = await messagesFor(chat.id);
  await addMessage(chat.id, { role: "user", content: message });
  const [memory, snap] = await Promise.all([listMemory(), snapshot(ctx)]);

  const result = await runAgent({
    ctx,
    question: message,
    history: historyOf(prior),
    memory,
    snapshot: snap,
    deadline: o.deadline,
    prefer: chat.model,
    emit: { status: (t) => o.onStatus?.(t), query: (s) => o.onQuery?.(s) },
    checkAction: async (raw) => {
      try {
        await prepareAction(ctx, raw);
        return null;
      } catch (e) {
        return e instanceof UserError ? e.message : "invalid";
      }
    },
  });

  let memoryChanged = false;
  if (result.remember.length) memoryChanged = (await addMemory(result.remember, chat.id)) > 0 || memoryChanged;
  if (result.forget.length) memoryChanged = (await deleteMemory(result.forget)) > 0 || memoryChanged;

  // proposed changes become buttons; nothing is applied until tapped
  const blocks = [...result.blocks];
  if (result.actions.length) {
    const { items } = await proposeActions(ctx, chat.id, result.actions);
    if (items.length) blocks.unshift({ type: "actions", items });
  }
  const saved = await addMessage(chat.id, { role: "assistant", content: result.content, blocks, steps: result.steps, model: result.model });
  let title: string | undefined;
  if (!prior.length && result.title) {
    await renameChat(chat.id, result.title);
    chat.title = result.title;
    title = result.title;
  }
  return { chat, message: saved, title, memoryChanged };
}
