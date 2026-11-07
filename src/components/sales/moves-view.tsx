"use client";

import { Check, Clock, Copy, ExternalLink, Globe, Linkedin, Loader2, Mail, MessageCircle, Phone, Plus, RefreshCw, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addMoveAction, draftMoveAction, moveOpenedAction, moveSentAction, moveStatusAction, refreshMovesAction, sendMoveEmailAction, snoozeMoveAction,
} from "@/app/sales-actions";
import { Button, Chip, Input, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { MoveRow } from "@/lib/sales/moves";
import { platformOf, replyTargets, targetInput, type Target } from "@/lib/sales/reply-targets";
import { ago } from "./util";

// red = act now, yellow = needs attention, green = money and good news, blue = a new action to start, grey = housekeeping
const KIND: Record<string, { label: string; tone: string }> = {
  reply: { label: "Reply", tone: "bg-p-rose text-p-rose-fg" },
  quote_hot: { label: "Hot", tone: "bg-p-rose text-p-rose-fg" },
  commit_mine: { label: "Your promise", tone: "bg-p-butter text-p-butter-fg" },
  payment_due: { label: "Money", tone: "bg-p-mint text-p-mint-fg" },
  debrief: { label: "Debrief", tone: "bg-p-butter text-p-butter-fg" },
  first_touch: { label: "First touch", tone: "bg-p-sky text-p-sky-fg" },
  follow_up: { label: "Follow-up", tone: "bg-p-butter text-p-butter-fg" },
  breakup: { label: "Last follow-up", tone: "bg-p-butter text-p-butter-fg" },
  reengage: { label: "Re-engage", tone: "bg-p-butter text-p-butter-fg" },
  commit_theirs: { label: "Their promise", tone: "bg-p-butter text-p-butter-fg" },
  quote_unseen: { label: "Quote unseen", tone: "bg-p-butter text-p-butter-fg" },
  quote_silent: { label: "Quote read", tone: "bg-p-butter text-p-butter-fg" },
  stale: { label: "Stuck", tone: "bg-muted text-subtle" },
  resurrect: { label: "Revisit", tone: "bg-p-butter text-p-butter-fg" },
  referral_ask: { label: "Referral", tone: "bg-p-mint text-p-mint-fg" },
  next_action: { label: "Next step", tone: "bg-p-sky text-p-sky-fg" },
  radar: { label: "New lead", tone: "bg-p-sky text-p-sky-fg" },
  custom: { label: "To do", tone: "bg-muted text-subtle" },
};

/** Copies text; when the browser refuses (some Safari setups), says so plainly instead of failing silently. */
async function copyText(text: string, toast: (m: string, k?: "ok" | "error") => void, ok = "Copied"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
    return true;
  } catch {
    toast("Your browser blocked copying. Select the text in the box and copy it by hand.", "error");
    return false;
  }
}

const TARGET_ICON: Record<string, typeof Mail> = {
  whatsapp: MessageCircle, gmail: Mail, mail: Mail, linkedin: Linkedin, find_linkedin: Search, find_dm: Search, website: Globe, call: Phone, platform: ExternalLink,
};

export function MoveCard({ m, googleReady, onGone }: { m: MoveRow; googleReady: boolean; onGone: (id: number) => void }) {
  const [move, setMove] = useState(m);
  const [text, setText] = useState(m.draft ?? "");
  const [subject, setSubject] = useState(m.draft_subject ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState<Target | null>(null);
  const [, start] = useTransition();
  const { toast } = useToast();
  const k = KIND[move.kind] ?? KIND.custom;
  const overdue = new Date(move.due_at).getTime() < Date.now();
  const targets = replyTargets(targetInput({ ...move, draft: text, draft_subject: subject }, googleReady));
  const sendable = targets.filter((t) => t.kind !== "find");
  const research = targets.filter((t) => t.kind === "find");
  const platform = platformOf(targetInput(move, googleReady).source_url);

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>, gone = true) =>
    start(async () => {
      setBusy(label);
      const r = await fn();
      setBusy(null);
      if (!r.ok) toast((r as { error: string }).error, "error");
      else if (gone) onGone(move.id);
    });

  const draft = () =>
    start(async () => {
      setBusy("draft");
      const r = await draftMoveAction(move.id);
      setBusy(null);
      if (!r.ok) return toast(r.error, "error");
      if (r.move) {
        setMove(r.move);
        setText(r.move.draft ?? "");
        setSubject(r.move.draft_subject ?? "");
      }
    });

  const use = (t: Target) => {
    if (t.kind === "find") {
      window.open(t.url!, "_blank", "noopener");
      return;
    }
    if (t.kind === "send") {
      if (!confirm(t.hint.replace("Sends right now", "Send this now"))) return;
      return run("gmail", () => sendMoveEmailAction(move.id, text, subject || `Re: ${move.deal_title ?? ""}`));
    }
    if (t.kind === "copy_open") {
      void copyText(text, toast, "Text copied. Paste it there.");
    }
    void moveOpenedAction(move.id, t.id, text, subject);
    if (t.kind === "call") window.location.href = t.url!;
    else window.open(t.url!, "_blank", "noopener");
    setAwaiting(t);
  };

  return (
    <li className={cn("rounded-2xl border bg-surface p-3 shadow-[var(--shadow-sm)]", overdue ? "border-border" : "border-dashed border-border")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", k.tone)}>{k.label}</span>
            <span className="text-[11px] text-subtle">due {ago(move.due_at)}</span>
            {move.stage_name ? <Chip className="text-[10px]">{move.stage_name}</Chip> : null}
          </div>
          <p className="mt-1 text-sm font-semibold leading-snug">{move.title}</p>
          {move.why ? <p className="mt-0.5 text-xs text-subtle">{move.why}</p> : null}
          {move.deal_id && (move.person_name || move.deal_title) ? (
            <p className="mt-1 text-xs">
              <Link href={`/sales/deal/${move.deal_id}`} className="font-medium text-accent hover:underline">
                {move.person_name ?? move.deal_title}
                {move.company_name && move.person_name ? ` · ${move.company_name}` : ""}
              </Link>
            </p>
          ) : null}
          {platform && move.radar_item_id && !move.deal_id ? (
            <p className="mt-1 text-xs text-subtle">
              Posted on <b className="text-fg">{platform.name}</b>
              {platform.replyable ? "; you answer it there." : "; it is a signal, nobody asked you directly."}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" title="Done another way: closes it without logging a message" aria-label="Done another way" onClick={() => run("done", () => moveStatusAction(move.id, "done"))}>
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Remind me tomorrow" aria-label="Snooze to tomorrow" onClick={() => run("snooze", () => snoozeMoveAction(move.id, 24))}>
            <Clock className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Skip: not doing this one" aria-label="Skip" onClick={() => run("skip", () => moveStatusAction(move.id, "skipped"))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {move.draft || text ? (
        <div className="mt-3 space-y-2">
          {move.channel === "email" || move.channel === "gmail" || move.channel === "mail" || subject ? <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="h-9 text-sm" /> : null}
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[90px] text-sm" />
        </div>
      ) : null}

      {awaiting ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-accent-muted px-3 py-2 text-sm">
          <span className="font-medium text-accent">Did you send it{awaiting.kind === "call" ? "" : ` on ${awaiting.where}`}?{awaiting.kind === "call" ? " Did you speak?" : ""}</span>
          <Button size="sm" variant="primary" onClick={() => run("sent", () => moveSentAction(move.id, awaiting.id, text))}>Yes, {awaiting.kind === "call" ? "we spoke" : "sent"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setAwaiting(null)}>Not yet</Button>
          <span className="w-full text-[11px] text-subtle">Only "Yes" logs it on the timeline. Nothing is recorded just because a link was opened.</span>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={text ? "outline" : "primary"} disabled={busy === "draft"} onClick={draft}>
              {busy === "draft" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : text ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {text ? "Redraft" : `Draft for ${platform?.replyable && (!move.deal_id || !sendable.some((t) => t.id !== "platform")) ? platform.name : sendable[0]?.where ?? "email"}`}
            </Button>
            {text
              ? sendable.map((t) => {
                  const I = TARGET_ICON[t.id] ?? ExternalLink;
                  return (
                    <Button key={t.id} size="sm" variant="outline" disabled={busy === t.id} title={t.hint} onClick={() => use(t)}>
                      {busy === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <I className="h-3.5 w-3.5" />} {t.label}
                    </Button>
                  );
                })
              : null}
            {text ? (
              <Button size="sm" variant="ghost" onClick={() => void copyText(text, toast)}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
            ) : null}
            {research.map((t) => {
              const I = TARGET_ICON[t.id] ?? ExternalLink;
              return (
                <Button key={t.id} size="sm" variant="ghost" title={t.hint} onClick={() => use(t)}>
                  <I className="h-3.5 w-3.5" /> {t.label}
                </Button>
              );
            })}
          </div>
          {text && sendable.length ? (
            <ul className="space-y-0.5 text-[11px] text-subtle">
              {sendable.map((t) => <li key={t.id}><b className="font-medium text-fg">{t.label}:</b> {t.hint}</li>)}
            </ul>
          ) : null}
          {text && !sendable.length ? (
            <p className="text-[11px] text-subtle">No way to reach them is saved yet. {research.length ? "Use the search above to find them, then add their phone, email or LinkedIn on the deal." : "Add their phone, email or LinkedIn on the deal."} Until then, copy the text.</p>
          ) : null}
        </div>
      )}
    </li>
  );
}

export function MovesView({ moves, googleReady }: { moves: MoveRow[]; googleReady: boolean }) {
  const [gone, setGone] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useToast();
  const visible = moves.filter((m) => !gone.has(m.id));
  const now = visible.filter((m) => new Date(m.due_at).getTime() <= Date.now());
  const later = visible.filter((m) => new Date(m.due_at).getTime() > Date.now());
  const remove = (id: number) => setGone((s) => new Set(s).add(id));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add your own move (e.g. call Rahul about the demo)" className="h-9 max-w-md flex-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) start(async () => {
              const r = await addMoveAction(null, title);
              if (!r.ok) toast(r.error, "error");
              setTitle("");
              router.refresh();
            });
          }}
        />
        <Button size="sm" variant="outline" disabled={!title.trim() || pending} onClick={() => start(async () => {
          await addMoveAction(null, title);
          setTitle("");
          router.refresh();
        })}>
          <Plus className="h-4 w-4" /> Add
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
          await refreshMovesAction();
          router.refresh();
        })}>
          <RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} /> Recheck
        </Button>
      </div>
      <section>
        <h2 className="mb-2 font-display text-lg">Do now <span className="text-sm font-normal text-subtle">· {now.length}</span></h2>
        {now.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">{now.map((m) => <MoveCard key={m.id} m={m} googleReady={googleReady} onGone={remove} />)}</ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-subtle">Nothing due right now. Start new conversations from the Radar, or log what happened today.</p>
        )}
      </section>
      {later.length ? (
        <section>
          <h2 className="mb-2 font-display text-lg">Coming up <span className="text-sm font-normal text-subtle">· next 2 days</span></h2>
          <ul className="grid gap-3 lg:grid-cols-2">{later.map((m) => <MoveCard key={m.id} m={m} googleReady={googleReady} onGone={remove} />)}</ul>
        </section>
      ) : null}
    </div>
  );
}
