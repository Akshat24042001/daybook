"use client";

import { ArrowDownLeft, ArrowUpRight, Check, Copy, Loader2, Mail, MessageCircle, RefreshCw, Sparkles, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { quickActionAction, summarizeDealAction } from "@/app/sales-actions";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { QuickAction } from "@/lib/sales/ingest";
import { noDashes } from "@/lib/text/no-dashes";

const KIND_LABEL: Record<QuickAction["kind"], string> = {
  reply: "Reply", follow_up: "Follow up", promise: "Your promise", meeting: "Meeting", call: "Call", send: "Send", stage: "Stage",
};
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const fmtWhen = (s: string | Date) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export interface Contact { phone?: string | null; email?: string | null; name?: string | null }

/** A reply you could send now: copy it, or open it in WhatsApp or email, ready to send. */
export function ReplyDraft({ text, contact }: { text: string; contact?: Contact }) {
  const { toast } = useToast();
  const clean = noDashes(text);
  const digits = (contact?.phone ?? "").replace(/\D/g, "");
  return (
    <div className="rounded-xl border border-border bg-muted/50 p-2.5" aria-label="Suggested reply">
      <p className="mb-1 text-xs font-medium text-subtle">Reply you could send</p>
      <p className="whitespace-pre-line text-sm">{clean}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(clean).then(() => toast("Reply copied"), () => toast("Your browser blocked copying.", "error"))}><Copy className="h-3.5 w-3.5" /> Copy</Button>
        {digits.length >= 8 ? <a className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-sm hover:bg-muted" href={`https://wa.me/${digits}?text=${encodeURIComponent(clean)}`} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a> : null}
        {contact?.email ? <a className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-sm hover:bg-muted" href={`mailto:${encodeURIComponent(contact.email)}?body=${encodeURIComponent(clean)}`}><Mail className="h-3.5 w-3.5" /> Email</a> : null}
      </div>
    </div>
  );
}

/**
 * Quick actions: one click does it. Follow-ups, calls, meetings and sends become the deal's next step (with the date);
 * a promise goes on the promise list; a stage change opens the usual move sheet. The cross drops one you do not want.
 */
export function QuickActions({ dealId, actions, done = [], onStage }: { dealId: number; actions: QuickAction[]; done?: number[]; onStage?: (role: string) => void }) {
  const [busy, start] = useTransition();
  const [gone, setGone] = useState<number[]>([]);
  const { toast } = useToast();
  const router = useRouter();
  const open = actions.map((a, i) => ({ a, i })).filter(({ i }) => !done.includes(i) && !gone.includes(i));
  if (!open.length) return null;
  const act = (i: number, a: QuickAction, mode: "do" | "dismiss") => {
    if (mode === "do" && a.kind === "stage" && a.stage && onStage) return onStage(a.stage);
    setGone((g) => [...g, i]);
    start(async () => {
      const r = await quickActionAction(dealId, i, a, mode);
      if (!r.ok) {
        setGone((g) => g.filter((x) => x !== i));
        return toast(r.error, "error");
      }
      if (mode === "do") toast(a.kind === "promise" ? "Added to your promises" : "Set as the next step");
      router.refresh();
    });
  };
  return (
    <ul className="space-y-1.5" aria-label="Quick actions">
      {open.map(({ a, i }) => (
        <li key={i} className="flex items-start gap-2 rounded-xl border border-border p-2">
          <span className="mt-0.5 rounded-md bg-accent-muted px-1.5 py-0.5 text-[11px] font-medium text-accent">{KIND_LABEL[a.kind]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{a.label}{a.due ? <span className="ml-1 text-xs font-normal text-subtle">by {fmtDay(a.due)}</span> : null}</p>
            {a.detail ? <p className="text-xs text-subtle">{a.detail}</p> : null}
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(i, a, "do")} aria-label={`Do it: ${a.label}`}><Check className="h-3.5 w-3.5" /> {a.kind === "stage" ? "Move" : a.kind === "promise" ? "Add promise" : "Make next step"}</Button>
          <button type="button" aria-label={`Not now: ${a.label}`} disabled={busy} onClick={() => act(i, a, "dismiss")} className="mt-1.5 text-subtle/60 hover:text-bad"><X className="h-3.5 w-3.5" /></button>
        </li>
      ))}
    </ul>
  );
}

interface TimelineLine { id: number; occurred_at: string | Date; channel: string; direction: string; summary: string | null; subject: string | null; body: string | null }

/**
 * The whole conversation on one card: what is going on (summary), the latest touches in order, the reply you could
 * send and the quick actions. "Summarize again" rebuilds it from every logged touch.
 */
export function ConversationCard({ dealId, summary, timeline, conversation, contact, onStage, extra }: {
  dealId: number;
  summary: string | null;
  timeline: TimelineLine[];
  conversation: { quick_actions?: QuickAction[]; reply_draft?: string | null; at?: string; done?: number[] } | null;
  contact?: Contact;
  onStage?: (role: string) => void;
  extra?: React.ReactNode;
}) {
  const [busy, start] = useTransition();
  const [all, setAll] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const recent = [...timeline].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
  const shown = all ? recent.slice(0, 30) : recent.slice(0, 5);
  const Dir = (d: string) => (d === "in" ? ArrowDownLeft : d === "out" ? ArrowUpRight : Users);
  return (
    <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Conversation">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-display text-base">Where we are</h3>
        <Button size="sm" variant="ghost" disabled={busy || !timeline.length} onClick={() => start(async () => {
          const r = await summarizeDealAction(dealId);
          if (!r.ok) return toast(r.error, "error");
          toast("Summary and next steps updated");
          router.refresh();
        })}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {busy ? "Reading it all…" : "Summarize again"}
        </Button>
      </div>
      {summary ? <p className="whitespace-pre-line text-sm">{summary}</p> : <p className="text-sm text-subtle">Log a chat, a call or a screenshot below and this fills itself.</p>}
      {extra}

      {conversation?.quick_actions?.length ? (
        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-subtle"><Sparkles className="h-3 w-3 text-accent" /> Do next</p>
          <QuickActions dealId={dealId} actions={conversation.quick_actions} done={conversation.done} onStage={onStage} />
        </div>
      ) : null}
      {conversation?.reply_draft ? <div className="mt-3"><ReplyDraft text={conversation.reply_draft} contact={contact} /></div> : null}

      {recent.length ? (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Timeline</p>
          <ol className="relative space-y-1.5 border-l border-border pl-3" aria-label="Conversation timeline">
            {shown.map((t) => {
              const D = Dir(t.direction);
              return (
                <li key={t.id} className="relative text-[13px]">
                  <span className="absolute -left-[15.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-subtle/50" aria-hidden />
                  <span className="text-xs text-subtle"><D className="mr-0.5 inline h-3 w-3" />{fmtWhen(t.occurred_at)} · {t.channel.replace("_", " ")}{t.direction === "in" ? " · them" : t.direction === "out" ? " · you" : t.direction === "both" ? " · both" : t.channel === "note" ? "" : " · note"}</span>
                  <p className="line-clamp-2">{t.summary || t.subject || (t.body ?? "").slice(0, 200)}</p>
                </li>
              );
            })}
          </ol>
          {recent.length > 5 ? (
            <button type="button" className={cn("mt-1 text-xs text-accent hover:underline")} onClick={() => setAll((x) => !x)}>
              {all ? "Show less" : `Show ${Math.min(recent.length, 30) - 5} more`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
