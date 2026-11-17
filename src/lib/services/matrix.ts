/**
 * Priorities: two well known 2x2 boards over all your open tasks.
 *
 *   Value x Effort (also called Impact x Effort, or the action priority matrix)
 *     Quick wins   high value, low effort   do these first
 *     Big bets     high value, high effort  plan them, give them real time
 *     Fill-ins     low value, low effort    when you have a gap
 *     Time sinks   low value, high effort   drop or rethink
 *
 *   Urgent x Important (the Eisenhower matrix)
 *     Do now       urgent and important
 *     Schedule     important, not urgent    put a date on it
 *     Delegate     urgent, not important    hand it off
 *     Drop         neither
 *
 * Each axis is stored on the task (migration 053), so a task keeps its place in both boards. Urgency you have not set
 * is read from the due date (due in two days or overdue = urgent), the way the method defines urgency. The AI can sort
 * what is still unsorted; it only suggests, you place.
 */
import { one, q, UserError } from "../db";
import type { Ctx } from "../settings";
import {
  AXES, BOXES, boxDef, boxOf, heuristic, type Box, type Mode, type Suggestion, type MatrixTask,
} from "../matrix";

export * from "../matrix";

/** Every open task, with what the boards need. */
export async function matrixTasks(ctx: Ctx): Promise<MatrixTask[]> {
  return q<MatrixTask>(
    `select t.id, t.title, t.type, p.name as project, p.color, t.is_personal, t.estimate_min, t.due_date::text as due_date,
            t.value_level, t.effort_level, t.importance, t.urgency, t.value_rank, t.eisen_rank, t.matrix_why, t.carry_count,
            to_char(t.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
            exists (select 1 from day_entries e where e.task_id = t.id and e.date = $1) as on_today,
            (t.waiting_until is not null and t.waiting_until >= $1::date) as waiting
       from tasks t left join projects p on p.id = t.project_id
      where t.state = 'active'
      order by t.created_at desc, t.id desc
      limit 3000`,
    [ctx.today],
  );
}

/**
 * Puts a task in a box (or back to "to sort" with null). `order` is the box's ids top to bottom after the drop, so
 * your order is kept. Setting a box sets both axes; urgency set here is yours from then on (no longer read from the date).
 */
export async function placeTask(id: number, mode: Mode, box: Box | null, order?: number[]): Promise<void> {
  const ax = AXES[mode];
  const t = await one<{ id: number }>("select id from tasks where id = $1 and state = 'active'", [id]);
  if (!t) throw new UserError("That task is closed or gone.");
  if (box === null) {
    await q(`update tasks set ${ax.aCol} = null, ${ax.bCol} = null, ${ax.rank} = null, matrix_why = null where id = $1`, [id]);
    return;
  }
  const def = boxDef(mode, box);
  if (!def) throw new UserError("Pick one of the four boxes.");
  await q(`update tasks set ${ax.aCol} = $2, ${ax.bCol} = $3, matrix_why = null where id = $1`, [id, def.levels[0], def.levels[1]]);
  if (order?.length) await orderBox(mode, order);
}

/** Saves the order of a box: the first id is at the top. */
export async function orderBox(mode: Mode, ids: number[]): Promise<void> {
  const clean = [...new Set(ids.filter((x) => Number.isInteger(x)))].slice(0, 1000);
  if (!clean.length) return;
  await q(
    `update tasks t set ${AXES[mode].rank} = o.n from unnest($1::int[]) with ordinality as o(id, n) where t.id = o.id`,
    [clean],
  );
}

/** Closes a group of tasks as dropped (the Time sinks or Drop box). Undo brings them back. */
export async function dropTasks(ids: number[]): Promise<number> {
  const r = await q<{ id: number }>("update tasks set state = 'dropped', closed_at = now() where id = any($1::int[]) and state = 'active' returning id", [ids]);
  return r.length;
}

// ------------------------------------------------------------------ AI sorting

/**
 * Suggests a box for every task still to sort on a board. The AI reads each task with its project, notes, estimate,
 * due date, how often it was carried over, and what you are working towards (your projects and targets). Facts only:
 * when a task says too little, it is left for you. Nothing is saved until you accept.
 */
export async function suggestBoxes(ctx: Ctx, mode: Mode, onlyIds?: number[]): Promise<Suggestion[]> {
  const all = await matrixTasks(ctx);
  const todo = all.filter((t) => !boxOf(t, mode, ctx.today) && (!onlyIds || onlyIds.includes(t.id))).slice(0, 80);
  if (!todo.length) return [];
  const notes = new Map((await q<{ id: number; notes: string | null }>("select id, notes from tasks where id = any($1::int[])", [todo.map((t) => t.id)])).map((r) => [r.id, r.notes]));
  const { llmConfigured, llmJson } = await import("../sales/llm");
  if (!llmConfigured()) return heuristic(todo, mode, ctx.today);

  const goals = await q<{ title: string }>("select title from tasks where state = 'active' and type = 'target' order by id desc limit 10");
  const projects = await q<{ name: string; n: number }>(
    "select p.name, count(*)::int as n from tasks t join projects p on p.id = t.project_id where t.state = 'active' group by p.name order by n desc limit 12");
  const { salesConfig } = await import("../sales/config");
  const owner = (await salesConfig().catch(() => null))?.owner;
  const lines = todo.map((t) => [
    `#${t.id}: ${t.title}`,
    t.project ? `project ${t.project}` : null,
    t.is_personal ? "personal" : null,
    t.type !== "one_off" ? `type ${t.type.replace(/_/g, " ")}` : null,
    t.estimate_min ? `estimate ${t.estimate_min} min` : null,
    t.due_date ? `due ${t.due_date}` : null,
    t.carry_count >= 2 ? `carried over ${t.carry_count} times` : null,
    notes.get(t.id) ? `notes: ${notes.get(t.id)!.replace(/\s+/g, " ").slice(0, 200)}` : null,
  ].filter(Boolean).join(" | "));

  const board = mode === "value"
    ? `VALUE x EFFORT board. Boxes: quick (high value, low effort), big (high value, high effort), fill (low value, low effort), sink (low value, high effort).
VALUE = how much it moves the owner's business, income, health or key relationships forward. EFFORT = total time and complexity to finish, including waiting on others; use the estimate when given (2h or more is high, 45 min or less is low).`
    : `URGENT x IMPORTANT (Eisenhower) board. Boxes: do (important and urgent), schedule (important, not urgent), delegate (urgent, not important), drop (neither).
IMPORTANT = serves the owner's goals and responsibilities. URGENT = has a real deadline within 2 days (today is ${ctx.today}) or a cost of waiting now. A task with no date is not urgent unless its text says so.`;
  const res = await llmJson<{ items: { id: number; box: string; why: string }[] }>(
    `You sort tasks for ${owner?.name ?? "the owner"}${owner?.company ? `, who runs ${owner.company}` : ""}.
${board}
WHAT THEY WORK TOWARDS: ${[...goals.map((g) => g.title), ...projects.map((p) => `project ${p.name} (${p.n} open tasks)`)].join("; ") || "not recorded"}.
Rules: judge from the task text and details only, never invent facts. If a task is too vague to judge, leave it out. "why" is one short plain sentence (under 14 words) a busy person can check at a glance. No dashes as punctuation.
Answer: {"items":[{"id":123,"box":"quick","why":"..."}]}`,
    lines.join("\n"),
    { maxTokens: 3000, totalMs: 45_000 },
  ).catch(() => null);
  if (!res?.items) return heuristic(todo, mode, ctx.today);
  const keys = new Set(BOXES[mode].map((b) => b.key as string));
  const byId = new Map(todo.map((t) => [t.id, t]));
  return res.items
    .filter((x) => byId.has(Number(x.id)) && keys.has(String(x.box)))
    .map((x) => ({ id: Number(x.id), title: byId.get(Number(x.id))!.title, box: x.box as Box, why: String(x.why ?? "").slice(0, 140) }));
}

/** Saves accepted suggestions; each keeps its reason on the card until you move it. */
export async function applySuggestions(mode: Mode, items: { id: number; box: Box; why?: string }[]): Promise<number> {
  const ax = AXES[mode];
  let n = 0;
  for (const it of items.slice(0, 200)) {
    const def = boxDef(mode, it.box);
    if (!def) continue;
    const r = await q<{ id: number }>(
      `update tasks set ${ax.aCol} = $2, ${ax.bCol} = $3, matrix_why = $4 where id = $1 and state = 'active' returning id`,
      [it.id, def.levels[0], def.levels[1], it.why ? `AI: ${it.why}`.slice(0, 160) : null]);
    n += r.length;
  }
  return n;
}
