import type { Metadata } from "next";
import { TaskForm } from "@/components/task/task-form";
import { one, q } from "@/lib/db";
import { parseQuickAdd } from "@/lib/parser";
import { makeCtx } from "@/lib/settings";
import { fmtHM } from "@/lib/time";
import { deepgramReady } from "@/lib/voice-config";

export const metadata: Metadata = { title: "New task" };
export const dynamic = "force-dynamic";

/** "Edit in app" from the Telegram preview lands here with ?pending=<id>, prefilled from the parsed line. */
export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ pending?: string }> }) {
  const { pending } = await searchParams;
  const ctx = await makeCtx();
  const pendingId = Number(pending);
  const row = Number.isInteger(pendingId) ? await one<{ text: string }>("select text from pending_adds where id = $1", [pendingId]) : null;
  const parsed = row ? parseQuickAdd(row.text.replace(/^LOG:/, ""), { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin }) : null;
  const [projects, people] = await Promise.all([
    q<{ name: string }>("select name from projects where not archived order by lower(name)"),
    q<{ name: string }>("select name from people order by lower(name)"),
  ]);

  return (
    <TaskForm
      mode="new"
      pendingId={row ? pendingId : null}
      voiceEnabled={deepgramReady()}
      projects={projects.map((p) => p.name)}
      people={people.map((p) => p.name)}
      today={ctx.today}
      history={[]}
      totals={{ minutes: 0, days: 0 }}
      task={{
        id: 0,
        title: parsed?.title ?? "",
        notes: "",
        type: parsed?.type ?? "one_off",
        project: parsed?.project ?? "",
        person: parsed?.person ?? "",
        personRole: parsed?.personRole ?? "with",
        via: parsed?.via ?? "",
        isPersonal: parsed?.isPersonal ?? false,
        estimateMin: parsed?.estimateMin ?? null,
        dueDate: parsed?.date ?? "",
        dueTime: parsed?.dueAt ? fmtHM(parsed.dueAt, ctx.tz) : "",
        leadMin: null,
        cadenceDays: parsed?.cadenceDays ?? null,
        rrule: parsed?.rrule ?? "",
        targetPeriod: parsed?.targetPeriod ?? null,
        goalMin: parsed?.goalMin ?? null,
        goalCount: null,
        state: "active",
        carry: 0,
        createdDay: ctx.today,
        mustDo: parsed?.mustDo ?? false,
      }}
    />
  );
}
