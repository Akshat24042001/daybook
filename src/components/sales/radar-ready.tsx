"use client";

import { Building2, Check, CircleDashed, Copy, Globe, Linkedin, Loader2, Mail, MessageCircle, Phone, RefreshCw, Sparkles, UserRound, X } from "lucide-react";
import { useState, useTransition } from "react";
import { radarDraftAction } from "@/app/sales-actions";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { MoveRow } from "@/lib/sales/moves";
import type { Pack, Prep, PrepStep } from "@/lib/sales/radar-prep";
import { noDashes } from "@/lib/text/no-dashes";
import { MoveCard } from "./moves-view";

const STEPS: [PrepStep, string][] = [["brief", "Requirement understood"], ["behind", "Business behind the post"], ["pack", "Decision maker and contacts"], ["draft", "Draft written"]];

/** Where the automatic preparation is: done, running, or what stopped a step. */
export function PrepChecklist({ prep }: { prep: Prep }) {
  const order = STEPS.map(([k]) => k);
  const at = prep.stage === "ready" ? order.length : order.indexOf(prep.stage as PrepStep);
  const stale = prep.stage !== "ready" && Date.now() - new Date(prep.started_at).getTime() > 30 * 60_000;
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Preparation">
      {STEPS.map(([k, label], i) => {
        const s = prep.steps[k];
        const running = !s && i === at && !stale;
        return (
          <li key={k} className={cn("inline-flex items-center gap-1", s?.ok ? "text-good" : s ? "text-subtle" : running ? "text-accent" : "text-subtle/70")} title={s?.note}>
            {s?.ok ? <Check className="h-3.5 w-3.5" /> : s ? <X className="h-3.5 w-3.5" /> : running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleDashed className="h-3.5 w-3.5" />}
            {label}{s && !s.ok ? <span className="text-subtle/80">: {s.note.slice(0, 70)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The lead, made ready: who decides, how to reach them, what matters about the company, and the message to send.
 * Everything here came from the automatic preparation; nothing on it was clicked for.
 */
export function ReadyPack({ itemId, prep, draft, subject, channel, onDrafted }: {
  itemId: number; prep: Prep; draft: string | null; subject: string | null; channel: string | null; onDrafted?: (m: MoveRow) => void;
}) {
  const [busy, start] = useTransition();
  const [move, setMove] = useState<MoveRow | null>(null);
  const { toast } = useToast();
  const pack: Pack | null | undefined = prep.pack;
  const dm = pack?.decision_maker;
  const co = pack?.company;
  const text = noDashes(move?.draft ?? draft ?? "");
  const subj = move?.draft_subject ?? subject ?? "";
  const email = dm?.email ?? pack?.contacts.emails[0] ?? null;
  const phone = dm?.phone ?? pack?.contacts.whatsapp ?? pack?.contacts.phones[0] ?? null;
  const copy = (t: string, what: string) => void navigator.clipboard.writeText(t).then(() => toast(`${what} copied`), () => toast("Your browser blocked copying.", "error"));

  return (
    <section className="rounded-xl border border-good/40 bg-good/5 p-3" aria-label="Ready lead">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-good"><Sparkles className="h-3.5 w-3.5" />{prep.stage === "ready" ? "Ready for you" : "Getting it ready"}</h3>
        <PrepChecklist prep={prep} />
      </div>

      {dm || co ? (
        <div className="grid gap-2 md:grid-cols-2">
          {dm ? (
            <div className="rounded-lg border border-border bg-surface p-2.5" aria-label="Decision maker">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Decision maker</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold"><UserRound className="h-4 w-4 text-subtle" />{dm.name}</p>
              {dm.title ? <p className="text-sm text-subtle">{dm.title}</p> : null}
              {dm.why ? <p className="mt-0.5 text-xs text-subtle">{dm.why}</p> : null}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {dm.email ? <a href={`mailto:${dm.email}`} className="act"><Mail className="h-3.5 w-3.5" />{dm.email}</a> : null}
                {dm.phone ? <a href={`tel:${dm.phone.replace(/[^\d+]/g, "")}`} className="act"><Phone className="h-3.5 w-3.5" />{dm.phone}</a> : null}
                {dm.linkedin ? <a href={dm.linkedin} target="_blank" rel="noreferrer" className="act"><Linkedin className="h-3.5 w-3.5" />LinkedIn</a> : null}
              </div>
            </div>
          ) : null}
          {co ? (
            <div className="rounded-lg border border-border bg-surface p-2.5" aria-label="Company">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Company</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold"><Building2 className="h-4 w-4 text-subtle" />{co.name}</p>
              <p className="text-xs text-subtle">{[co.location, co.size, co.founded ? `since ${co.founded}` : null, co.revenue].filter(Boolean).join(" · ")}</p>
              {co.what_they_do ? <p className="mt-1 text-sm">{co.what_they_do}</p> : null}
              {co.budget ? <p className="mt-1 text-xs"><b>Realistic budget:</b> {co.budget}</p> : null}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {co.website ? <a href={co.website} target="_blank" rel="noreferrer" className="act"><Globe className="h-3.5 w-3.5" />{co.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a> : null}
                {pack?.contacts.emails.filter((e) => e !== dm?.email).slice(0, 2).map((e) => <a key={e} href={`mailto:${e}`} className="act"><Mail className="h-3.5 w-3.5" />{e}</a>)}
                {pack?.contacts.phones.filter((p) => p !== dm?.phone).slice(0, 1).map((p) => <a key={p} href={`tel:${p.replace(/[^\d+]/g, "")}`} className="act"><Phone className="h-3.5 w-3.5" />{p}</a>)}
                {pack?.contacts.contact_page ? <a href={pack.contacts.contact_page} target="_blank" rel="noreferrer" className="act">Contact page</a> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : prep.stage === "ready" ? (
        <p className="text-sm text-subtle">{prep.steps.behind?.note ?? "No business could be tied to this post."} The draft below is written to reply where they posted.</p>
      ) : null}

      {co?.summary ? <p className="mt-2 text-sm"><b>About them:</b> {co.summary}</p> : null}
      {pack?.insights.length ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-sm md:grid-cols-2" aria-label="Insights">
          {pack.insights.slice(0, 8).map((x) => (
            <div key={x.label}><dt className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{x.label}</dt><dd>{x.text}</dd></div>
          ))}
        </dl>
      ) : null}
      {pack?.others.length ? (
        <p className="mt-2 text-xs text-subtle">Also there: {pack.others.map((o) => `${o.name}${o.title ? ` (${o.title})` : ""}`).join(" · ")}</p>
      ) : null}

      {move ? (
        <div className="mt-2"><MoveCard m={move} googleReady={false} onGone={() => setMove(null)} /></div>
      ) : text ? (
        <div className="mt-2 rounded-lg border border-border bg-surface p-2.5" aria-label="Ready draft">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Message ready{channel ? ` (${channel.replace("_", " ")})` : ""}</p>
          {subj ? <p className="mt-1 text-sm font-medium">{subj}</p> : null}
          <p className="mt-1 whitespace-pre-line text-sm">{text}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {email ? <a href={`mailto:${email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(text)}`} className="act act-primary"><Mail className="h-3.5 w-3.5" />Email it to {email}</a> : null}
            {phone ? <a href={`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className={cn("act", !email && "act-primary")}><MessageCircle className="h-3.5 w-3.5" />WhatsApp it</a> : null}
            <button type="button" className="act" onClick={() => copy(subj ? `${subj}\n\n${text}` : text, "Message")}><Copy className="h-3.5 w-3.5" />Copy</button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => {
              const r = await radarDraftAction(itemId);
              if (!r.ok) return toast(r.error, "error");
              if (r.move) { setMove(r.move); onDrafted?.(r.move); }
            })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Rewrite and log it</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
