"use client";

import { Check, Clock, Copy, ExternalLink, Loader2, Mail, MessageCircle, Phone, RefreshCw, Sparkles, X, Linkedin, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addMoveAction, draftMoveAction, moveDoneAction, moveStatusAction, refreshMovesAction, saveDraftAction, sendMoveEmailAction, snoozeMoveAction,
} from "@/app/sales-actions";
import { Button, Chip, Input, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { MoveRow } from "@/lib/sales/moves";
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

function waUrl(phone: string | null | undefined, text: string): string {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10 && /^[6-9]/.test(d)) d = `91${d}`;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function MoveCard({ m, googleReady, onGone }: { m: MoveRow; googleReady: boolean; onGone: (id: number) => void }) {
  const [move, setMove] = useState(m);
  const [text, setText] = useState(m.draft ?? "");
  const [subject, setSubject] = useState(m.draft_subject ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const { toast } = useToast();
  const k = KIND[move.kind] ?? KIND.custom;
  const phone = move.phones?.[0];
  const email = move.emails?.[0];
  const overdue = new Date(move.due_at).getTime() < Date.now();

  const act = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>, gone = true) =>
    start(async () => {
      setBusy(label);
      const r = await fn();
      setBusy(null);
      if (!r.ok) toast((r as { error: string }).error, "error");
      else if (gone) onGone(move.id);
    });

  const draft = (channel?: string) =>
    start(async () => {
      setBusy("draft");
      const r = await draftMoveAction(move.id, channel);
      setBusy(null);
      if (!r.ok) return toast(r.error, "error");
      if (r.move) {
        setMove(r.move);
        setText(r.move.draft ?? "");
        setSubject(r.move.draft_subject ?? "");
      }
    });

  const sendVia = (channel: "whatsapp" | "email" | "linkedin" | "call") => {
    if (text !== (move.draft ?? "")) void saveDraftAction(move.id, text, subject);
    if (channel === "email" && googleReady && email) return act("email", () => sendMoveEmailAction(move.id, text, subject || `Re: ${move.deal_title ?? ""}`));
    if (channel === "whatsapp") window.open(waUrl(phone, text), "_blank");
    if (channel === "email") window.open(`mailto:${email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, "_blank");
    if (channel === "linkedin") {
      void navigator.clipboard?.writeText(text);
      toast("Draft copied. Paste it in LinkedIn.");
      if (move.linkedin) window.open(/^https?:/.test(move.linkedin) ? move.linkedin : `https://www.linkedin.com/in/${move.linkedin.replace(/^in\//, "")}`, "_blank");
    }
    if (channel === "call" && phone) window.location.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
    act(channel, () => moveDoneAction(move.id, channel, text));
  };

  return (
    <li className={cn("rounded-2xl border bg-surface p-3 shadow-[var(--shadow-sm)]", overdue ? "border-border" : "border-dashed border-border")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", k.tone)}>{k.label}</span>
            <span className="text-[11px] text-subtle">{overdue ? `due ${ago(move.due_at)}` : `due ${ago(move.due_at)}`}</span>
            {move.stage_name ? <Chip className="text-[10px]">{move.stage_name}</Chip> : null}
          </div>
          <p className="mt-1 text-sm font-semibold leading-snug">{move.title}</p>
          {move.why ? <p className="mt-0.5 text-xs text-subtle">{move.why}</p> : null}
          {move.person_name || move.deal_title ? (
            <p className="mt-1 text-xs">
              {move.deal_id ? (
                <Link href={`/sales/deal/${move.deal_id}`} className="font-medium text-accent hover:underline">
                  {move.person_name ?? move.deal_title}
                  {move.company_name && move.person_name ? ` · ${move.company_name}` : ""}
                </Link>
              ) : (
                move.deal_title
              )}
            </p>
          ) : null}
          {move.radar_url ? (
            <a href={move.radar_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline">
              Open post <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" title="Done" aria-label="Done" onClick={() => act("done", () => moveStatusAction(move.id, "done"))}>
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Tomorrow" aria-label="Snooze to tomorrow" onClick={() => act("snooze", () => snoozeMoveAction(move.id, 24))}>
            <Clock className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Skip" aria-label="Skip" onClick={() => act("skip", () => moveStatusAction(move.id, "skipped"))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {move.draft || text ? (
        <div className="mt-3 space-y-2">
          {move.channel === "email" || subject ? <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="h-9 text-sm" /> : null}
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[90px] text-sm" />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" variant={move.draft ? "outline" : "primary"} disabled={busy === "draft"} onClick={() => draft()}>
          {busy === "draft" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : move.draft ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          {move.draft ? "Redraft" : "Draft in my voice"}
        </Button>
        {text ? (
          <>
            {phone ? (
              <Button size="sm" variant="outline" onClick={() => sendVia("whatsapp")}>
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </Button>
            ) : null}
            {email ? (
              <Button size="sm" variant="outline" disabled={busy === "email"} onClick={() => sendVia("email")}>
                {busy === "email" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} {googleReady ? "Send email" : "Email"}
              </Button>
            ) : null}
            {move.linkedin || (!phone && !email) ? (
              <Button size="sm" variant="outline" onClick={() => sendVia("linkedin")}>
                <Linkedin className="h-3.5 w-3.5" /> LinkedIn
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast("Copied"))}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </>
        ) : null}
        {phone ? (
          <Button size="sm" variant="ghost" onClick={() => sendVia("call")}>
            <Phone className="h-3.5 w-3.5" /> Call
          </Button>
        ) : null}
      </div>
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
