import { one, q, UserError } from "../db";
import { transcribe, voiceConfigured, VoiceError } from "../deepgram";
import { voiceToQuickAdd } from "../voice";
import { describeTimeLog, looksLikeTimeLog, parseTimeLog, resolveSegments } from "../timelog";
import { describeParsed, parseQuickAdd } from "../parser";
import { buildCtx, getSettings, type Ctx } from "../settings";
import { atLogical, addDays, fmtDuration, fmtHM, parseHM } from "../time";
import type { EntryStatus, EntryView } from "../types";
import {
  addEntry, getEntry, logMinutes, moveEntry, scheduleTaskPing, setEntryStatus, setMustDo, entriesForDate,
  RETRY_HOURS,
} from "../services/entries";
import { setScore, setSteps } from "../services/days";
import { cadenceToNudge, listCadence, listSomeday, snoozeCadence } from "../services/goals";
import { createSegments, endOpenSegment, KIND_LABEL, switchState, workedForDate, type StateKind } from "../services/segments";
import {
  exerciseSlots, getExerciseType, listExerciseTypes, logExercise,
} from "../services/health";
import { appendNote, createFromParsed, findDuplicates, getTask } from "../services/tasks";
import {
  answerCallback, downloadFile, editMarkup, editMessage, esc, sendMessage, telegramConfigured,
  type InlineMarkup, type Markup, type ReplyKeyboard,
} from "./api";
import { sendRecapOnce } from "./notify";
import {
  exerciseCountsLine, exercisePing, exerciseTypePicker, inline, minutesPrompt, recapMarkup, retryPrompt, scoreDecimals,
  slotFromCode, taskAction, todayList, unpackDate, urlBtn, STATUS_EMOJI, STATUS_WORD, type Msg,
} from "./ui";

// ---------------------------------------------------------------- types

interface TgChat { id: number; type: string }
interface TgFile { file_id: string; mime_type?: string; duration?: number }
interface TgMessage { message_id: number; chat: TgChat; text?: string; voice?: TgFile; audio?: TgFile; reply_to_message?: TgMessage }
interface TgCallback { id: string; from: { id: number }; message?: TgMessage; data?: string }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

// ---------------------------------------------------------------- persistent keyboard

export const KEYS = {
  office: "🏢 At office",
  outside: "🚗 Out on work",
  break: "🍽 Break",
  off: "🏁 Day end",
  today: "📋 Today",
  free: "🙂 I'm free",
} as const;

export const PERSISTENT_KEYBOARD: ReplyKeyboard = {
  keyboard: [
    [{ text: KEYS.office }, { text: KEYS.outside }],
    [{ text: KEYS.break }, { text: KEYS.off }],
    [{ text: KEYS.today }, { text: KEYS.free }],
  ],
  is_persistent: true,
  resize_keyboard: true,
};

const norm = (s: string) => s.replace(/[️‍]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const KEY_LOOKUP = new Map(Object.entries(KEYS).map(([k, v]) => [norm(v), k as keyof typeof KEYS]));

// ---------------------------------------------------------------- owner lock

function envOwnerId(): number | null {
  const raw = (process.env.TELEGRAM_OWNER_CHAT_ID ?? "").trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) ? n : null;
}

/**
 * Owner lock (PRD 9.1): only the owner's chat is processed, everything else is ignored silently.
 * With no owner configured, the first /start (in a private chat) stores the chat id and locks the bot.
 */
async function resolveOwner(chatId: number | undefined, message: TgMessage | undefined, ctx: Ctx): Promise<boolean> {
  if (chatId === undefined) return false;
  const owner = envOwnerId() ?? ctx.s.telegram_chat_id;
  if (owner) return chatId === owner;
  if (message?.text && /^\/start(@\w+)?(\s|$)/.test(message.text) && message.chat.type === "private") {
    await q("update settings set telegram_chat_id = $1 where id = 1 and telegram_chat_id is null", [chatId]);
    ctx.s.telegram_chat_id = chatId;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- entry point

export async function handleUpdate(update: TgUpdate, now: Date = new Date()): Promise<void> {
  if (!telegramConfigured()) return;
  const fresh = await one<{ update_id: number }>(
    "insert into tg_updates (update_id) values ($1) on conflict do nothing returning update_id",
    [update.update_id],
  );
  if (!fresh) return; // Telegram re-delivered an update we already handled

  const s = await getSettings();
  const ctx = buildCtx(s, now);
  const cb = update.callback_query;
  const msg = update.message;
  const chatId = msg?.chat.id ?? cb?.message?.chat.id;
  if (!(await resolveOwner(chatId, msg, ctx))) return; // stranger: ignore silently, no reply, no spinner fix

  const chat = chatId!;
  const reply = (text: string, markup?: Markup) => sendMessage(chat, text, markup);

  if (cb) {
    let toast: string | undefined;
    try {
      toast = await handleCallback(ctx, chat, cb);
    } catch (e) {
      toast = errorText(e);
      if (!(e instanceof UserError)) console.error("[bot] callback error:", (e as Error).name, (e as Error).message);
    } finally {
      await answerCallback(cb.id, toast);
    }
    return;
  }

  if (msg?.text || msg?.voice || msg?.audio) {
    try {
      if (msg.voice || msg.audio) await handleVoice(ctx, chat, msg);
      else await handleText(ctx, chat, msg.text!.trim(), { replyToId: msg.reply_to_message?.message_id });
    } catch (e) {
      if (e instanceof UserError) await reply(`⚠️ ${esc(e.message)}`).catch(() => {});
      else {
        console.error("[bot] message error:", (e as Error).name, (e as Error).message);
        await reply("Something went wrong on my side. Try again in a moment.").catch(() => {});
      }
    }
  }
}

function errorText(e: unknown): string {
  return e instanceof UserError ? e.message : "Something went wrong. Try again.";
}

// ---------------------------------------------------------------- text messages

interface TextOpts {
  /** the text came from a voice note (already transcribed) */
  voice?: boolean;
  /** the user replied to one of our messages (e.g. the "add a note" prompt) */
  replyToId?: number;
}

async function handleText(ctx: Ctx, chat: number, text: string, opts: TextOpts = {}): Promise<void> {
  // A reply to the "add a note" prompt attaches the text (or transcript) to that task.
  if (opts.replyToId) {
    const prompt = await one<{ ref_id: string }>(
      "select ref_id from notifications where kind = 'note_prompt' and telegram_message_id = $1",
      [opts.replyToId],
    );
    if (prompt) {
      const task = await appendNote(ctx, Number(prompt.ref_id), text);
      await sendMessage(chat, `📝 Note saved to <b>${esc(task.title)}</b>.`);
      return;
    }
  }
  if (opts.voice) {
    await routeFreeText(ctx, chat, text, true);
    return;
  }
  if (/^\/start(@\w+)?(\s|$)/.test(text)) {
    await sendMessage(
      chat,
      "Daybook is linked to this chat. Use the buttons below to switch state and see today, or just type a task.",
      PERSISTENT_KEYBOARD,
    );
    return;
  }
  if (/^\/pause(@\w+)?$/.test(text)) {
    const paused = !ctx.s.exercise_paused;
    await q("update settings set exercise_paused = $1 where id = 1", [paused]);
    await sendMessage(chat, paused ? "Exercise pings paused. Send /pause again to resume." : "Exercise pings resumed.");
    return;
  }
  if (text.startsWith("/")) {
    await sendMessage(chat, "I only know /start and /pause. Anything else you type is added as a task.");
    return;
  }

  const key = KEY_LOOKUP.get(norm(text));
  switch (key) {
    case "office":
    case "outside":
    case "break":
    case "off":
      await stateSwitch(ctx, chat, key);
      return;
    case "today": {
      const m = await todayList(ctx);
      await sendMessage(chat, m.text, m.markup);
      return;
    }
    case "free": {
      await sendMessage(chat, "🙂 How much time do you have?", inline([[
        { text: "15m", callback_data: "fr:15" },
        { text: "30m", callback_data: "fr:30" },
        { text: "1h", callback_data: "fr:60" },
      ]]));
      return;
    }
    default:
      if (await tryTextCommand(ctx, chat, text)) return;
      await routeFreeText(ctx, chat, text, false);
  }
}

/**
 * Natural language text commands so you never need to touch a button.
 * Returns true if the text was handled as a command.
 *
 * Supported:
 *   done <name>        — mark matching open task as done
 *   skip <name>        — mark matching open task as skipped
 *   prog[ressed] <name>— mark as progressed
 *   score <n>          — set today's score (1–10)
 *   steps <n>          — log step count for today
 *   log <n>m <name>    — log N minutes on matching task
 *   plan               — show today's plan (same as "Today" button)
 */
async function tryTextCommand(ctx: Ctx, chat: number, text: string): Promise<boolean> {
  // score <n> — matches "score 8", "score is 8", "today score 8.5", "set score 7", etc.
  const scoreM = text.match(/(?:^|\s)score(?:\s+is)?\s+(\d+(?:[.,]\d+)?)/i);
  if (scoreM) {
    const val = parseFloat(scoreM[1].replace(",", "."));
    if (val < 0 || val > 10) { await sendMessage(chat, "⚠️ Score must be between 0 and 10."); return true; }
    await setScore(ctx.today, val);
    await sendMessage(chat, `🙂 Score for today set to <b>${val}</b>.`);
    return true;
  }

  // steps <n> — "steps 8000", "steps: 9500", "walked 6000 steps"
  const stepsM = text.match(/(?:^|\s)steps?\s*:?\s*(\d[\d,]+)|(\d[\d,]+)\s+steps/i);
  if (stepsM) {
    const raw = (stepsM[1] ?? stepsM[2]).replace(/,/g, "");
    const val = parseInt(raw, 10);
    await setSteps(ctx.today, val);
    await sendMessage(chat, `👣 Steps logged: <b>${val.toLocaleString("en-US")}</b> for today.`);
    return true;
  }

  // plan / today — show today's list
  if (/^(plan|today|list)$/i.test(text)) {
    const m = await todayList(ctx);
    await sendMessage(chat, m.text, m.markup);
    return true;
  }

  // done <name> | skip <name> | prog <name> | progressed <name>
  const actionM = text.match(/^(done|skip(?:ped)?|prog(?:ressed)?)\s+(.+)$/i);
  if (actionM) {
    const rawAction = actionM[1].toLowerCase();
    const status: EntryStatus =
      rawAction === "done" ? "done"
      : rawAction.startsWith("skip") ? "skipped"
      : "progressed";
    const query = actionM[2].trim().toLowerCase();
    const entries = await entriesForDate(ctx.today);
    const match = entries.find(
      (e) => e.status === "open" && e.task_state === "active" && e.title.toLowerCase().includes(query),
    );
    if (!match) {
      await sendMessage(
        chat,
        `⚠️ No open task matching "<b>${esc(query)}</b>" today.\nSend "plan" to see today's list.`,
      );
      return true;
    }
    const r = await setEntryStatus(ctx, match.id, status);
    await sendMessage(
      chat,
      `${STATUS_EMOJI[status]} <b>${esc(r.entry.title)}</b>: ${STATUS_WORD[status]}.`,
      status === "done" || status === "progressed" ? minutesPrompt(r.entry, status).markup : undefined,
    );
    return true;
  }

  // log <n>m[in] [on] <name>   e.g. "log 45m workout" or "log 1h gym"
  const logM = text.match(/^log\s+(\d+(?:\.\d+)?)\s*(h|hr|hour|m|min|mins|minutes)(?:\s+(?:on\s+)?(.+))?$/i);
  if (logM) {
    const raw = parseFloat(logM[1]);
    const unit = logM[2].toLowerCase();
    const minutes = Math.round(unit === "h" || unit === "hr" || unit === "hour" ? raw * 60 : raw);
    const query = (logM[3] ?? "").trim().toLowerCase();
    const entries = await entriesForDate(ctx.today);
    const candidates = entries.filter((e) => e.task_state === "active");
    const match = query
      ? candidates.find((e) => e.title.toLowerCase().includes(query))
      : candidates.find((e) => e.status !== "open"); // last touched task
    if (!match) {
      await sendMessage(
        chat,
        query
          ? `⚠️ No task matching "<b>${esc(query)}</b>" today.`
          : "⚠️ Tell me which task: <i>log 30m workout</i>",
      );
      return true;
    }
    await logMinutes(ctx, match.task_id, ctx.today, minutes, "telegram");
    const fresh = await getEntry(match.id);
    await sendMessage(
      chat,
      `⏱ <b>${esc(match.title)}</b>: ${fmtDuration(minutes)} logged (${fmtDuration(fresh?.minutes_today ?? minutes)} today).`,
    );
    return true;
  }

  return false;
}

/** Free text is either a manual time entry ("office 10:45 to 1:30") or a quick-add task line. */
async function routeFreeText(ctx: Ctx, chat: number, text: string, fromVoice: boolean): Promise<void> {
  if (looksLikeTimeLog(text)) {
    await timeLogPreview(ctx, chat, text);
    return;
  }
  await quickAddPreview(ctx, chat, fromVoice ? voiceToQuickAdd(text) : text);
}

// ---------------------------------------------------------------- voice notes

async function handleVoice(ctx: Ctx, chat: number, msg: TgMessage): Promise<void> {
  const file = msg.voice ?? msg.audio!;
  if (!voiceConfigured()) {
    await sendMessage(chat, "Voice notes need a Deepgram key. Add DEEPGRAM_API_KEY to the environment, then try again.");
    return;
  }
  let transcript: string;
  try {
    const { data, contentType } = await downloadFile(file.file_id);
    transcript = await transcribe(data, file.mime_type ?? contentType);
  } catch (e) {
    if (e instanceof VoiceError) {
      await sendMessage(chat, `🎙 ${esc(e.message)}`);
      return;
    }
    throw e;
  }
  await sendMessage(chat, `🎙 Heard: “${esc(transcript)}”`);
  await handleText(ctx, chat, transcript, { voice: true, replyToId: msg.reply_to_message?.message_id });
}

// ---------------------------------------------------------------- manual time entry

async function timeLogPreview(ctx: Ctx, chat: number, text: string): Promise<void> {
  const parsed = parseTimeLog(text, { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin });
  if (!parsed || (parsed.segments.length === 0 && parsed.errors.length === 0)) {
    await sendMessage(chat, "I could not find times in that. Try: office 10:45 to 1:30");
    return;
  }
  if (parsed.errors.length) {
    await sendMessage(chat, `⚠️ ${esc(parsed.errors[0])}`);
    return;
  }
  const pending = await one<{ id: number }>("insert into pending_adds (text) values ($1) returning id", [`LOG:${text}`]);
  const pid = pending!.id;
  const d = describeTimeLog(parsed);
  const dayNote = parsed.date === ctx.today ? "today" : parsed.date;
  await sendMessage(
    chat,
    `⏱ <b>Log time for ${dayNote}?</b>\n${d.lines.map(esc).join("\n")}\nWorked: <b>${fmtDuration(d.workedMin)}</b>${d.lines.some((l) => l.startsWith("Break")) ? " (breaks not counted)" : ""}`,
    inline([[
      { text: "✅ Save", callback_data: `tl:s:${pid}` },
      { text: "Add as task instead", callback_data: `tl:t:${pid}` },
      { text: "✗ Cancel", callback_data: `tl:x:${pid}` },
    ]]),
  );
}

async function timeLogAction(ctx: Ctx, chat: number, mid: number | undefined, action: string, id: number): Promise<string | undefined> {
  const edit = async (text: string, markup?: InlineMarkup) => {
    if (mid) await editMessage(chat, mid, text, markup);
  };
  const pending = await one<{ text: string }>("select text from pending_adds where id = $1", [id]);
  if (!pending) throw new UserError("That preview expired. Send the times again.");
  const raw = pending.text.replace(/^LOG:/, "");
  if (action === "x") {
    await q("delete from pending_adds where id = $1", [id]);
    await edit("✗ Cancelled. Nothing was logged.");
    return "Cancelled";
  }
  if (action === "t") {
    await q("delete from pending_adds where id = $1", [id]);
    await edit("Adding it as a task instead…");
    await quickAddPreview(ctx, chat, raw);
    return undefined;
  }
  const tctx = { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin };
  const parsed = parseTimeLog(raw, tctx);
  if (!parsed || parsed.errors.length) throw new UserError(parsed?.errors[0] ?? "I could not read those times.");
  await createSegments(ctx, resolveSegments(parsed, tctx));
  await q("delete from pending_adds where id = $1", [id]);
  const worked = await workedForDate(ctx, parsed.date);
  await edit(`✅ Logged. Worked ${fmtDuration(worked)} on ${parsed.date === ctx.today ? "today" : parsed.date}.\n${describeTimeLog(parsed).lines.map(esc).join("\n")}`);
  return "Time logged";
}

// ---------------------------------------------------------------- state switching

async function stateSwitch(ctx: Ctx, chat: number, kind: StateKind): Promise<void> {
  const r = await switchState(ctx, kind);
  if (kind === "off") {
    if (!r.changed) {
      await sendMessage(chat, `Day already ended. Worked ${fmtDuration(r.workedMin)}.`);
    } else {
      await sendMessage(chat, `🏁 Day ended. Worked ${fmtDuration(r.workedMin)}.`);
    }
    const sent = await sendRecapOnce(ctx, chat, r.date);
    if (!sent.sent && r.changed) await sendMessage(chat, "The recap for today was already sent above.");
    return;
  }
  const label = KIND_LABEL[kind];
  const from = fmtHM(r.since, ctx.tz);
  const text = r.changed
    ? `${label} from ${from}. ${fmtDuration(r.workedMin)} so far.`
    : `Already ${label.toLowerCase()} since ${from}. ${fmtDuration(r.workedMin)} so far.`;
  await sendMessage(chat, text);
}

// ---------------------------------------------------------------- free text quick-add

async function quickAddPreview(ctx: Ctx, chat: number, text: string): Promise<void> {
  const parsed = parseQuickAdd(text, { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin });
  if (parsed.errors.length) {
    await sendMessage(chat, `⚠️ ${esc(parsed.errors[0])}`);
    return;
  }
  const dups = await findDuplicates(parsed);
  const pending = await one<{ id: number }>("insert into pending_adds (text) values ($1) returning id", [text]);
  const pid = pending!.id;
  const lines = describeParsed(parsed, { tz: ctx.tz, today: ctx.today });
  let body = `<b>${esc(parsed.title)}</b>\n${lines.map(esc).join(" · ")}`;
  for (const n of parsed.notes) body += `\n<i>${esc(n)}</i>`;
  const rows: InlineMarkup["inline_keyboard"] = [];
  if (dups.length) {
    const d = dups[0];
    body += `\n\nA similar task already exists: <b>${esc(d.projectName ? `${d.projectName}: ${d.title}` : d.title)}</b>`;
    rows.push([{ text: "➕ Add existing task to today", callback_data: `qa:e:${d.id}` }]);
  }
  rows.push([
    { text: "✅ Add", callback_data: `qa:a:${pid}` },
    { text: "Tomorrow", callback_data: `qa:t:${pid}` },
    { text: "Someday", callback_data: `qa:s:${pid}` },
  ]);
  const edit = urlBtn("✏️ Edit in app", `/task/new?pending=${pid}`);
  if (edit) rows.push([edit]);
  await sendMessage(chat, body, { inline_keyboard: rows });
}

// ---------------------------------------------------------------- callbacks

async function handleCallback(ctx: Ctx, chat: number, cb: TgCallback): Promise<string | undefined> {
  const data = cb.data ?? "";
  const mid = cb.message?.message_id;
  const parts = data.split(":");
  const edit = async (m: Msg) => {
    if (mid) await editMessage(chat, mid, m.text, m.markup);
  };
  const send = (m: Msg) => sendMessage(chat, m.text, m.markup);
  const entryOrThrow = async (id: number): Promise<EntryView> => {
    const e = await getEntry(id);
    if (!e) throw new UserError("That task entry no longer exists.");
    return e;
  };

  switch (parts[0]) {
    // ---- task actions: t:<d|p|a|s|z|m|o>:<entryId>
    case "t": {
      const id = Number(parts[2]);
      switch (parts[1]) {
        case "d":
        case "p": {
          const status: EntryStatus = parts[1] === "d" ? "done" : "progressed";
          const r = await setEntryStatus(ctx, id, status);
          await edit(minutesPrompt(r.entry, status));
          return STATUS_WORD[status];
        }
        case "a": {
          const r = await setEntryStatus(ctx, id, "attempted");
          await edit(retryPrompt(r.entry));
          return "Attempted";
        }
        case "s": {
          const r = await setEntryStatus(ctx, id, "skipped");
          const t = await getTask(r.entry.task_id);
          await edit({ text: `✗ <b>${esc(r.entry.title)}</b>: Skipped${t && t.carry_count > 1 ? ` (carried ${t.carry_count}×)` : ""}.` });
          return "Skipped";
        }
        case "z": {
          const e = await entryOrThrow(id);
          await scheduleTaskPing("task_snooze", id, new Date(ctx.now.getTime() + 30 * 60_000));
          await edit({ text: `⏰ <b>${esc(e.title)}</b>: I'll remind you in 30 minutes.` });
          return "Snoozed 30m";
        }
        case "m": {
          const e = await entryOrThrow(id);
          const moved = await moveEntry(ctx, id, addDays(ctx.today, 1));
          await edit({ text: `🗓 <b>${esc(e.title)}</b> moved to tomorrow (${moved.date}).` });
          return "Moved to tomorrow";
        }
        case "o": {
          await send(taskAction(ctx, await entryOrThrow(id)));
          return undefined;
        }
        case "n": {
          const e = await entryOrThrow(id);
          const promptId = await sendMessage(
            chat,
            `📝 Reply to this message with a voice note or text to add a note to <b>${esc(e.title)}</b>.`,
            { force_reply: true, input_field_placeholder: "Speak or type your note" },
          );
          await q(
            `insert into notifications (kind, ref_id, scheduled_for, status, telegram_message_id, sent_at)
             values ('note_prompt', $1, $2, 'sent', $3, now()) on conflict do nothing`,
            [String(e.task_id), ctx.now, promptId],
          );
          return "Reply with your note";
        }
      }
      break;
    }

    // ---- minutes: tm:<entryId>:<min>
    case "tm": {
      const e = await entryOrThrow(Number(parts[1]));
      const min = Number(parts[2]);
      if (min > 0) await logMinutes(ctx, e.task_id, e.date, min, "telegram");
      const fresh = await entryOrThrow(e.id);
      await edit({
        text: `${STATUS_EMOJI[fresh.status]} <b>${esc(fresh.title)}</b>: ${STATUS_WORD[fresh.status]}${min > 0 ? ` · ${fmtDuration(min)} logged (${fmtDuration(fresh.minutes_today)} today)` : ""}`,
      });
      return min > 0 ? `${min}m logged` : "OK";
    }

    // ---- retry: rt:<entryId>:<2h|am|pm>
    case "rt": {
      const e = await entryOrThrow(Number(parts[1]));
      const choice = parts[2];
      let when: string;
      if (choice === "2h") {
        await scheduleTaskPing("task_retry", e.id, new Date(ctx.now.getTime() + 2 * 3_600_000));
        when = "in 2 hours";
      } else {
        const tomorrow = addDays(ctx.today, 1);
        const hour = RETRY_HOURS[choice === "am" ? "tam" : "tpm"];
        const next = await addEntry(ctx, e.task_id, tomorrow, { source: "planned" });
        await scheduleTaskPing("task_retry", next.id, atLogical(tomorrow, hour * 60, ctx.tz, ctx.boundaryMin));
        when = choice === "am" ? "tomorrow morning" : "tomorrow afternoon";
      }
      await edit({ text: `📞 <b>${esc(e.title)}</b>: Attempted. I'll bring it back ${when}.` });
      return "Retry scheduled";
    }

    // ---- demote a must-do: md:<entryId>
    case "md": {
      await setMustDo(ctx, Number(parts[1]), false);
      await edit({ text: "Demoted. Send your task again to add it as a must-do." });
      return "Demoted";
    }

    // ---- time entry: tl:<s|t|x>:<pendingId>
    case "tl":
      return timeLogAction(ctx, chat, mid, parts[1], Number(parts[2]));

    // ---- quick-add: qa:<a|t|s|e>:<pendingId|taskId>
    case "qa":
      return quickAddAction(ctx, chat, mid, parts[1], Number(parts[2]));

    // ---- I'm free: fr:<min>  |  fr:s:<taskId>
    case "fr": {
      if (parts[1] === "s") {
        const taskId = Number(parts[2]);
        const entry = await addEntry(ctx, taskId, ctx.today, { source: "planned" });
        const r = await setEntryStatus(ctx, entry.id, "progressed");
        await edit(minutesPrompt(r.entry, "progressed"));
        return "Started";
      }
      const minutes = Number(parts[1]);
      const cad = (await cadenceToNudge(ctx)).map((c) => c.task);
      const overdue = (await listCadence(ctx)).filter((c) => c.overdue).map((c) => c.task);
      const some = await listSomeday();
      const seen = new Set<number>();
      const picks = [...cad, ...overdue, ...some]
        .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
        .filter((t) => t.estimate_min === null || t.estimate_min <= minutes)
        .slice(0, 3);
      if (!picks.length) {
        await edit({ text: `Nothing fits ${minutes} minutes. Your Someday pool and cadence list are empty.` });
        return undefined;
      }
      await edit({
        text: `🙂 You have ${minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}. Pick one:`,
        markup: inline(picks.map((t) => [{ text: `▶ ${t.title}`.slice(0, 60), callback_data: `fr:s:${t.id}` }])),
      });
      return undefined;
    }

    // ---- exercise
    case "ex":
      return exerciseAction(ctx, chat, mid, parts);

    // ---- score: sc:m:<n>:<d> | sc:s:<val>:<d> | sc:c:<d>
    case "sc": {
      if (parts[1] === "m") {
        const date = unpackDate(parts[3]);
        if (mid) await editMarkup(chat, mid, inline([...scoreDecimals(date, Number(parts[2]))]));
        return `${parts[2]} — pick decimal`;
      }
      if (parts[1] === "s") {
        const date = unpackDate(parts[3]);
        const val = Number(parts[2]);
        await setScore(date, val);
        if (mid) await editMarkup(chat, mid, await recapMarkup(ctx, date));
        await sendMessage(chat, `🙂 Score set to <b>${val}</b> for ${date}.`);
        return `Score ${val} ✓`;
      }
      if (parts[1] === "c") {
        const date = unpackDate(parts[2]);
        if (mid) await editMarkup(chat, mid, await recapMarkup(ctx, date, { scoreGrid: true }));
        return "Change score";
      }
      break;
    }

    // ---- steps: st:<value>:<d>
    case "st": {
      const date = unpackDate(parts[2]);
      const value = Number(parts[1]);
      await setSteps(date, value);
      if (mid) await editMarkup(chat, mid, await recapMarkup(ctx, date));
      await sendMessage(chat, `👣 Steps set to <b>${value.toLocaleString("en-US")}</b> for ${date}.`);
      return `${value.toLocaleString("en-US")} steps ✓`;
    }

    // ---- cadence nudge: cd:<t|s>:<taskId>
    case "cd": {
      const taskId = Number(parts[2]);
      const t = await getTask(taskId);
      if (!t) throw new UserError("That task no longer exists.");
      if (parts[1] === "t") {
        await addEntry(ctx, taskId, ctx.today, { source: "planned" });
        await edit({ text: `🔁 <b>${esc(t.title)}</b> added to today.` });
        return "Added to today";
      }
      await snoozeCadence(ctx, taskId);
      await edit({ text: `🔁 <b>${esc(t.title)}</b> snoozed for a day.` });
      return "Snoozed";
    }

    // ---- state switch from an inline button: sw:<kind>
    case "sw": {
      const kind = parts[1] as StateKind;
      if (!["office", "outside", "break", "off"].includes(kind)) return undefined;
      await stateSwitch(ctx, chat, kind);
      return undefined;
    }

    // ---- forgotten close: sg:e:<minutesAgo>
    case "sg": {
      const r = await endOpenSegment(ctx, Number(parts[2]));
      await edit({
        text: r.ended
          ? `⏱ Ended at ${fmtHM(r.endedAt!, ctx.tz)}. Worked ${fmtDuration(r.workedMin)} today.`
          : "Nothing was running.",
      });
      return r.ended ? "Segment ended" : undefined;
    }
  }
  return undefined;
}

async function quickAddAction(
  ctx: Ctx,
  chat: number,
  mid: number | undefined,
  action: string,
  id: number,
): Promise<string | undefined> {
  const edit = async (text: string, markup?: InlineMarkup) => {
    if (mid) await editMessage(chat, mid, text, markup);
  };

  if (action === "e") {
    const t = await getTask(id);
    if (!t || t.state !== "active") throw new UserError("That task is no longer active.");
    const entry = await addEntry(ctx, id, ctx.today, { source: "planned" });
    await edit(`➕ <b>${esc(t.project_name ? `${t.project_name}: ${t.title}` : t.title)}</b> added to today.`, taskAction(ctx, (await getEntry(entry.id))!).markup);
    return "Added to today";
  }

  const pending = await one<{ text: string }>("select text from pending_adds where id = $1", [id]);
  if (!pending) throw new UserError("That preview expired. Send the task again.");
  const parsed = parseQuickAdd(pending.text, { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin });
  try {
    const opts =
      action === "t" ? { targetDate: addDays(ctx.today, 1) } : action === "s" ? { type: "someday" as const } : {};
    const { task, entry } = await createFromParsed(ctx, parsed, opts);
    await q("delete from pending_adds where id = $1", [id]);
    const where = action === "s" ? "Someday pool" : entry ? (entry.date === ctx.today ? "today" : entry.date) : "your list";
    const full = entry ? await getEntry(entry.id) : null;
    await edit(
      `✅ <b>${esc(task.project_name ? `${task.project_name}: ${task.title}` : task.title)}</b> added to ${esc(where)}.`,
      full ? taskAction(ctx, full).markup : inline([[urlBtn("Open in app", `/task/${task.id}`)]]),
    );
    return "Added";
  } catch (e) {
    if (e instanceof UserError && /Must-do cap/.test(e.message)) {
      const musts = (await entriesForDate(parsed.targetDate)).filter((x) => x.must_do && x.status !== "dropped");
      await edit(
        `⚠️ ${esc(e.message)}\nDemote one of these, then send your task again:`,
        inline(musts.map((m) => [{ text: `Demote: ${m.title}`.slice(0, 60), callback_data: `md:${m.id}` }])),
      );
      return "Must-do cap reached";
    }
    throw e;
  }
}

async function exerciseAction(ctx: Ctx, chat: number, mid: number | undefined, parts: string[]): Promise<string | undefined> {
  const edit = async (m: Msg) => {
    if (mid) await editMessage(chat, mid, m.text, m.markup);
  };
  switch (parts[1]) {
    case "n":
      return undefined;
    case "a": {
      // ex:a:<type>:<amount>:<slot>  edit in place, stateless
      const slot = slotFromCode(parts[4]);
      await edit(await exercisePing(ctx, slot, Number(parts[2]), Number(parts[3])));
      return undefined;
    }
    case "d": {
      const slot = slotFromCode(parts[4]);
      const type = await getExerciseType(Number(parts[2]));
      if (!type) throw new UserError("That exercise no longer exists.");
      await logExercise(ctx, slot, "done", type.id, Number(parts[3]), mid ?? null);
      const amt = type.unit === "seconds" ? `${parts[3]}s` : parts[3];
      await edit({ text: `✅ ${fmtHM(slot, ctx.tz)}: ${amt} ${esc(type.name)} logged. Today: ${await exerciseCountsLine(ctx.today)}.` });
      return "Logged";
    }
    case "s": {
      const slot = slotFromCode(parts[2]);
      await logExercise(ctx, slot, "skipped", null, null, mid ?? null);
      await edit({ text: `⏭ ${fmtHM(slot, ctx.tz)} skipped. Today: ${await exerciseCountsLine(ctx.today)}.` });
      return "Skipped";
    }
    case "c": {
      await edit(await exerciseTypePicker(ctx, slotFromCode(parts[2])));
      return undefined;
    }
    case "t": {
      const type = (await listExerciseTypes(true)).find((t) => t.id === Number(parts[2]));
      if (!type) throw new UserError("That exercise no longer exists.");
      await edit(await exercisePing(ctx, slotFromCode(parts[3]), type.id, type.default_amount));
      return undefined;
    }
  }
  return undefined;
}

// Re-exported for the tick and tests
export { exerciseSlots, parseHM };
