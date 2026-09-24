/**
 * OpenRouter LLM client for natural language task management.
 * API key read from OPENROUTER_API_KEY environment variable — never committed to code.
 */

export function aiConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Free, open-weight models on OpenRouter, best first. Free models come and go, so a request walks the list until
 * one answers. Override with AI_MODELS="vendor/model:free,vendor/other:free".
 */
export const OPEN_MODELS = [
  "z-ai/glm-5.2:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "qwen/qwen3.8-27b:free",
  "google/gemma-4-31b-it:free",
];

export function openModels(): string[] {
  const env = (process.env.AI_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return env.length ? env : OPEN_MODELS;
}

interface ChatOptions {
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
  /** budget across all fallback attempts */
  totalMs?: number;
}

async function chatOnce(messages: Message[], model: string, o: ChatOptions): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": process.env.APP_BASE_URL ?? "https://daybook.app",
      "X-Title": "Daybook",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: o.temperature ?? 0.2,
      max_tokens: o.maxTokens ?? 512,
      // reasoning models: think briefly and keep the thinking out of the answer
      reasoning: { effort: "low", exclude: true },
    }),
    signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const out = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!out) throw new Error(`OpenRouter ${model}: empty answer`);
  return out;
}

/** Tries each open model in turn; returns the first answer and which model gave it. */
export async function chatWithModel(messages: Message[], o: ChatOptions = {}): Promise<{ text: string; model: string }> {
  let last: Error | null = null;
  const deadline = Date.now() + (o.totalMs ?? 40_000);
  for (const model of openModels()) {
    const left = deadline - Date.now();
    if (left < 3_000) break;
    try {
      return { text: await chatOnce(messages, model, { ...o, timeoutMs: Math.min(o.timeoutMs ?? 15_000, left) }), model };
    } catch (e) {
      last = e as Error;
      console.warn("[ai] model failed, trying next:", model, last.message.slice(0, 120));
    }
  }
  throw last ?? new Error("No AI model available");
}

async function chat(messages: Message[], o: ChatOptions = {}): Promise<string> {
  return (await chatWithModel(messages, o)).text;
}

const SYSTEM_PROMPT = `You are a task assistant for Daybook, a personal productivity app.
Convert the user's natural language into the Daybook quick-add syntax. Respond with ONLY the converted syntax, no explanation.

Quick-add syntax rules:
- Task title is the plain text (required)
- Project: "ProjectName: task title" — prefix with project name and colon
- Estimate: ~30m, ~2h, ~1h30m (append after title)
- Must-do: !! (append)
- Date: @today, @tom, @mon, @tue, @wed, @thu, @fri, @sat, @sun, @15sep, @21oct
- Time: @5pm, @14:30
- Someday pool: ? (append)
- Recurring: "every mon", "every 15th"
- Cadence: *7d (every 7 days), *3d
- Person (with/for): +PersonName
- Personal: /p
- Ongoing: >> (append)

Examples:
User: "add call John tomorrow at 3pm, 30 minutes, it's for the project proposal"
Output: Call John @tom @3pm ~30m

User: "I need to review the Q3 report this week, probably takes 2 hours, mark it as must do"
Output: Review Q3 report ~2h !!

User: "add a task to work on the website redesign project, it's ongoing"
Output: Website: Redesign website >>

User: "remind me to follow up with Sarah about the contract every week"
Output: Follow up with Sarah about contract +Sarah *7d

User: "push the gym workout to someday, estimate 1 hour"
Output: Gym workout ~1h ?

Only output the syntax. If the input is too vague, make reasonable assumptions.`;

/** Converts natural language to Daybook quick-add syntax using the LLM. */
export async function interpretTaskInput(text: string): Promise<string> {
  return chat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: text },
  ]);
}

// ---------------------------------------------------------------- Telegram command interpreter

export type TgCommand =
  | { kind: "add"; syntax: string }
  | { kind: "done"; query: string }
  | { kind: "skip"; query: string }
  | { kind: "progressed"; query: string }
  | { kind: "score"; value: number }
  | { kind: "steps"; value: number }
  | { kind: "log"; minutes: number; query: string }
  | { kind: "worked"; minutes: number }
  | { kind: "exercise"; amount: number; name: string }
  | { kind: "plan" }
  | { kind: "unknown" };

function buildTgSystemPrompt(exerciseTypes: string[]): string {
  const exList = exerciseTypes.length
    ? `\nKnown exercise types in this user's app: ${exerciseTypes.join(", ")}. Any message mentioning one of these names + a quantity is ALWAYS an exercise log, never a task.`
    : "";
  return `You are the intent classifier for Daybook, a personal productivity app.
The user sends a casual message from Telegram. Understand natural language — no rigid keywords needed.
Return a single JSON object. No markdown, no explanation, just raw JSON.

DISAMBIGUATION RULES (read carefully):
1. If the message mentions a physical exercise (push-ups, squats, plank, run, walk, etc.) with a quantity → exercise.
2. "done/finished/completed X" where X is an exercise → exercise (NOT the done-task command).
3. "done/finished/completed X" where X is a work task → done.
4. Hours/minutes spent on a SPECIFIC named task → log. Hours worked in general today → worked.
5. A number out of 10, or "score", "rate", "rating" → score.
6. Step count, walking distance in steps → steps.
7. Something to do in the future, a reminder, or "add" → add.
8. Asking to see today's list → plan.
9. Anything truly ambiguous or a general observation with no clear action → unknown.${exList}

Commands:
{"kind":"exercise","amount":<number>,"name":"<exercise name>"} — user did a physical exercise. Convert word numbers to digits (five→5, twenty→20, etc.).
{"kind":"done","query":"<task name>"} — user completed a work/personal task (not a physical exercise).
{"kind":"skip","query":"<task name>"} — user is skipping a task.
{"kind":"progressed","query":"<task name>"} — user made partial progress on a task.
{"kind":"score","value":<0-10 number>} — user is rating their day.
{"kind":"steps","value":<integer>} — user logged step count.
{"kind":"log","minutes":<integer>,"query":"<task name>"} — user spent time on a specific named task.
{"kind":"worked","minutes":<integer>} — user recording total hours worked today (not a specific task).
{"kind":"add","syntax":"<quick-add syntax>"} — user wants to add a new task or reminder.
{"kind":"plan"} — user wants to see today's task list.
{"kind":"unknown"} — genuinely unclear; will be shown as a task-add preview.

Quick-add syntax for "add": plain title + optional: ~30m ~2h !! @today @tom @mon @3pm ? >> *7d +Person /p
Use "Project: title" prefix when a project name is stated.

Examples:
"I've done five push-ups" → {"kind":"exercise","amount":5,"name":"push-ups"}
"just did 20 squats" → {"kind":"exercise","amount":20,"name":"squats"}
"finished a 30 second plank" → {"kind":"exercise","amount":30,"name":"plank"}
"did three sets of fifteen push-ups" → {"kind":"exercise","amount":45,"name":"push-ups"}
"I'm done with my workout — 25 pushups" → {"kind":"exercise","amount":25,"name":"push-ups"}
"ran 5km" → {"kind":"exercise","amount":5,"name":"run"}
"I finished the report" → {"kind":"done","query":"report"}
"mark design review as done" → {"kind":"done","query":"design review"}
"skip the gym task today" → {"kind":"skip","query":"gym"}
"I worked 45 minutes on the proposal" → {"kind":"log","minutes":45,"query":"proposal"}
"log 2 hours on client project" → {"kind":"log","minutes":120,"query":"client project"}
"today was a 7 out of 10" → {"kind":"score","value":7}
"I walked 9000 steps" → {"kind":"steps","value":9000}
"call mom tomorrow" → {"kind":"add","syntax":"Call mom @tom"}
"add a must-do: review quarterly budget, 1 hour, tomorrow" → {"kind":"add","syntax":"Review quarterly budget @tom ~1h !!"}
"I worked 8 hours today" → {"kind":"worked","minutes":480}
"put in 6h30m today" → {"kind":"worked","minutes":390}
"what's on my list" → {"kind":"plan"}
"show today" → {"kind":"plan"}`;
}

/** Interprets a free-form Telegram message and returns a structured command.
 *  Pass exerciseTypeNames so the AI knows which exercise names exist in the user's app. */
export async function interpretTelegramMessage(text: string, exerciseTypeNames: string[] = []): Promise<TgCommand> {
  try {
    const raw = await chat(
      [
        { role: "system", content: buildTgSystemPrompt(exerciseTypeNames) },
        { role: "user", content: text },
      ],
      { timeoutMs: 12_000, totalMs: 20_000 },
    );
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as TgCommand;
    if (!parsed.kind) return { kind: "unknown" };
    return parsed;
  } catch {
    return { kind: "unknown" };
  }
}
