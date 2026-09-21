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

async function chat(messages: Message[], model = "openai/gpt-4o-mini"): Promise<string> {
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
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 512 }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
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

const TG_SYSTEM_PROMPT = `You are the command interpreter for Daybook, a personal productivity app.
The user sends a casual message from Telegram. Understand the intent naturally — no need for specific keywords or syntax.
Classify it as one of these commands and return JSON only.

Commands:
- {"kind":"add","syntax":"<quick-add syntax>"} — user wants to add a new task or reminder
- {"kind":"done","query":"<task name words>"} — user completed a task
- {"kind":"skip","query":"<task name words>"} — user is skipping or won't do a task
- {"kind":"progressed","query":"<task name words>"} — user made partial progress on a task
- {"kind":"score","value":<number 0-10>} — user is rating/scoring their day
- {"kind":"steps","value":<integer>} — user is logging step count or walking distance
- {"kind":"log","minutes":<integer>,"query":"<task name words>"} — user spent time on a specific task
- {"kind":"worked","minutes":<integer>} — user is recording total hours worked today (not tied to one task)
- {"kind":"exercise","amount":<number>,"name":"<exercise name>"} — user did an exercise (push-ups, squats, plank, etc.). Convert word numbers to digits.
- {"kind":"plan"} — user wants to see today's task list or plan
- {"kind":"unknown"} — none of the above; treat as a new task to add

Quick-add syntax for "add":
Title is plain text. Append: ~30m/~2h for estimate, !! for must-do, @today/@tom/@mon for date,
@3pm/@14:30 for time, ? for someday, >> for ongoing, *7d for cadence, +Person, /p for personal.
Use "Project: title" prefix when a project name is clearly stated.

Examples:
"I finished the report" → {"kind":"done","query":"report"}
"mark design review as done" → {"kind":"done","query":"design review"}
"skip the gym today" → {"kind":"skip","query":"gym"}
"I worked 45 minutes on the proposal" → {"kind":"log","minutes":45,"query":"proposal"}
"log 2 hours on client project" → {"kind":"log","minutes":120,"query":"client project"}
"today was a 7 out of 10" → {"kind":"score","value":7}
"set score to 8.5" → {"kind":"score","value":8.5}
"I walked 9000 steps" → {"kind":"steps","value":9000}
"add a task to call mom tomorrow" → {"kind":"add","syntax":"Call mom @tom"}
"I worked 8 hours today" → {"kind":"worked","minutes":480}
"worked 7 and a half hours" → {"kind":"worked","minutes":450}
"today I put in 6h30m" → {"kind":"worked","minutes":390}
"show me today" → {"kind":"plan"}
"what's on my list" → {"kind":"plan"}
"I've done five push-ups" → {"kind":"exercise","amount":5,"name":"push-ups"}
"just did 20 squats" → {"kind":"exercise","amount":20,"name":"squats"}
"finished a 30 second plank" → {"kind":"exercise","amount":30,"name":"plank"}
"did three sets of fifteen push-ups" → {"kind":"exercise","amount":45,"name":"push-ups"}
"I'm done with my workout — 25 pushups" → {"kind":"exercise","amount":25,"name":"push-ups"}

Return only valid JSON. No explanation, no markdown fences.`;

/** Interprets a free-form Telegram message and returns a structured command. */
export async function interpretTelegramMessage(text: string): Promise<TgCommand> {
  try {
    const raw = await chat(
      [{ role: "system", content: TG_SYSTEM_PROMPT }, { role: "user", content: text }],
      "moonshotai/kimi-k2",
    );
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as TgCommand;
    if (!parsed.kind) return { kind: "unknown" };
    return parsed;
  } catch {
    return { kind: "unknown" };
  }
}
