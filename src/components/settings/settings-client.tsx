"use client";

import { CheckCircle2, CircleAlert, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createPersonAction, testNotificationAction, updatePersonAction,
  updateSettingsAction,
} from "@/app/actions";
import type { SettingsPatch } from "@/lib/settings";
import { useToast } from "../toast";
import { ExerciseTypes, type ExerciseTypeData } from "../health/exercise-types";
import { Button, Card, ErrorNote, Field, Input, Select } from "../ui";

type S = Required<SettingsPatch>;

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">{title}</h2>
        {hint ? <p className="text-xs text-subtle">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Status({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 p-3">
      {ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-good" /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" />}
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-subtle">{detail}</p>
      </div>
    </li>
  );
}

export function SettingsClient({
  settings, people, types, status,
}: {
  settings: S;
  people: { id: number; name: string; relation: string | null }[];
  types: ExerciseTypeData[];
  status: {
    telegramToken: boolean; telegramLinked: boolean; ownerFromEnv: boolean; voice: boolean; auth: string;
    lastTick: string | null; lastTickAgeSec: number | null; appUrl: string; https: boolean;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<S>(settings);
  const set = <K extends keyof S>(k: K, v: S[K]) => setS((cur) => ({ ...cur, [k]: v }));
  const [newPerson, setNewPerson] = useState("");
  const [newRelation, setNewRelation] = useState("");

  function saveSettings() {
    setError(null);
    start(async () => {
      const r = await updateSettingsAction(s);
      if (!r.ok) setError(r.error);
      else {
        toast("Settings saved.");
        router.refresh();
      }
    });
  }
  const call = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast(r.error ?? "That did not work.", "error");
      else {
        toast(done);
        router.refresh();
      }
    });

  const tickOk = status.lastTickAgeSec !== null && status.lastTickAgeSec <= 600;
  const time = (label: string, k: keyof S, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input type="time" value={String(s[k])} onChange={(e) => set(k, e.target.value as S[typeof k])} />
    </Field>
  );
  const number = (label: string, k: keyof S, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input inputMode="decimal" value={String(s[k])} onChange={(e) => set(k, e.target.value.replace(/[^\d.]/g, "") as unknown as S[typeof k])} />
    </Field>
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-subtle">Everything here can be changed at any time.</p>
      </header>

      <Block title="Connections">
        <Card className="divide-y divide-border">
          <Status ok={status.auth !== "Local development (no login)"} label={`Sign-in: ${status.auth}`} detail={status.auth.startsWith("Local") ? "Fine while developing on this computer. A login is required once deployed." : "Only your account can open this app."} />
          <Status ok={status.telegramToken} label="Telegram bot token" detail={status.telegramToken ? "TELEGRAM_BOT_TOKEN is set." : "Not set. Add TELEGRAM_BOT_TOKEN to the environment."} />
          <Status
            ok={status.telegramLinked}
            label="Telegram chat"
            detail={status.telegramLinked ? (status.ownerFromEnv ? "Locked to TELEGRAM_OWNER_CHAT_ID." : "Linked and locked to your chat.") : "Send /start to your bot to link and lock it to your chat."}
          />
          <Status ok={status.https} label="App address for Telegram buttons" detail={status.https ? status.appUrl : `${status.appUrl || "not set"}. Telegram only accepts https links, so buttons that open the app appear once APP_BASE_URL is an https address.`} />
          <Status ok={status.voice} label="Voice input (Deepgram)" detail={status.voice ? "DEEPGRAM_API_KEY is set. Mic buttons and Telegram voice notes work." : "Not set. Add DEEPGRAM_API_KEY to turn on the mic buttons and Telegram voice notes."} />
          <Status ok={tickOk} label="Scheduler" detail={status.lastTick ? `Last tick ${status.lastTick}${tickOk ? "" : ". It should run every minute."}` : "The tick has never run. Start it with Supabase Cron (hosted) or npm run dev:cron (local)."} />
        </Card>
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={pending} onClick={() => call(testNotificationAction, "Test notification sent. Check Telegram.")}>
            <Send className="h-4 w-4" /> Send test notification
          </Button>
        </div>
      </Block>

      <Block title="Day">
        <Card className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Timezone" hint="An IANA name, e.g. Asia/Kolkata.">
              <Input value={s.timezone} onChange={(e) => set("timezone", e.target.value)} />
            </Field>
            {time("Day boundary", "day_boundary", "Late-night work before this time counts toward the previous day.")}
            {number("Available hours per day", "available_hours", "Used by the Plan capacity bar.")}
            {number("Must-do cap", "must_do_cap", "1 to 5 per day.")}
            {number("Rot threshold", "rot_threshold", "Times carried before a task counts as rotting.")}
            {number("Step goal", "step_goal")}
            {number("Task reminder lead (minutes)", "task_lead_min", "Per-task override on the task page.")}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">Working days</p>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map(([n, l]) => {
                const on = s.working_days.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set("working_days", on ? s.working_days.filter((d) => d !== n) : [...s.working_days, n].sort())}
                    className={`h-9 w-12 rounded-xl border text-sm font-medium ${on ? "border-accent bg-accent text-accent-fg" : "border-border hover:bg-muted"}`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </Block>

      <Block title="Telegram schedule" hint="No messages are sent inside quiet hours.">
        <Card className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {time("Morning brief", "morning_brief")}
            {time("Cadence nudge", "cadence_nudge")}
            {time("Recap fallback", "evening_fallback", "Sent if Day end was not tapped.")}
            {time("Score reminder", "score_reminder")}
            {time("Open segment check", "open_segment_check")}
            {time("Weekly review", "weekly_review_time")}
            <Field label="Weekly review day">
              <Select value={String(s.weekly_review_day)} onChange={(e) => set("weekly_review_day", Number(e.target.value))}>
                {DAYS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
              </Select>
            </Field>
            {time("Quiet hours start", "quiet_start")}
            {time("Quiet hours end", "quiet_end")}
          </div>
        </Card>
      </Block>

      <Block title="Exercise pings">
        <Card className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {time("First ping", "exercise_start")}
            {time("Last ping", "exercise_end")}
            {number("Every (minutes)", "exercise_interval_min")}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.exercise_paused} onChange={(e) => set("exercise_paused", e.target.checked)} className="h-4 w-4 accent-[hsl(var(--accent))]" />
            Pause exercise pings (also /pause in the bot)
          </label>
        </Card>
      </Block>

      <ErrorNote message={error} />
      <div className="sticky bottom-20 z-10 md:bottom-4">
        <Card className="flex items-center justify-between gap-3 p-3 shadow-lg">
          <p className="text-sm text-subtle">Changes above are saved together.</p>
          <Button variant="primary" onClick={saveSettings} disabled={pending}>Save settings</Button>
        </Card>
      </div>

      <Block title="Exercise types" hint="Name, default amount and unit. The bot starts each ping from the last one you used.">
        <ExerciseTypes types={types} />
      </Block>

      <Block title="People" hint="Used for follow-ups (with) and personal requests (requested by).">
        <ul className="space-y-2">
          {people.map((p) => (
            <PersonRow key={`${p.id}-${p.name}-${p.relation}`} p={p} onSave={(patch) => call(() => updatePersonAction(p.id, patch), "Person updated.")} pending={pending} />
          ))}
        </ul>
        <form className="grid grid-cols-[1fr_1fr_auto] gap-2" onSubmit={(e) => { e.preventDefault(); call(() => createPersonAction(newPerson, newRelation || null), "Person added."); setNewPerson(""); setNewRelation(""); }}>
          <Input value={newPerson} onChange={(e) => setNewPerson(e.target.value)} placeholder="Name" aria-label="New person" />
          <Input value={newRelation} onChange={(e) => setNewRelation(e.target.value)} placeholder="Relation (mom, client)" aria-label="Relation" />
          <Button type="submit" variant="outline" disabled={pending || !newPerson.trim()}>Add</Button>
        </form>
      </Block>
    </div>
  );
}

function PersonRow({ p, onSave, pending }: { p: { id: number; name: string; relation: string | null }; onSave: (patch: { name?: string; relation?: string | null }) => void; pending: boolean }) {
  const [name, setName] = useState(p.name);
  const [relation, setRelation] = useState(p.relation ?? "");
  const dirty = name !== p.name || relation !== (p.relation ?? "");
  return (
    <li className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-xl border border-border bg-surface p-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      <Input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Relation" aria-label="Relation" />
      <Button size="sm" variant="primary" disabled={pending || !dirty} onClick={() => onSave({ name, relation })}>Save</Button>
    </li>
  );
}
