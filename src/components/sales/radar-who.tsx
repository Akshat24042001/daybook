"use client";

import { Building2, Globe, Linkedin, Loader2, Mail, MapPin, Phone, UserRound, UserSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { findBehindAction, researchLeadAction } from "@/app/sales-actions";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";

export interface Poster { name?: string | null; username?: string | null; city?: string | null; country?: string | null; profile_url?: string | null; joined?: string | null; history?: string | null }
export interface WhoCandidate { company: string; website: string | null; location: string | null; person: string | null; why: string; confidence: "high" | "medium" | "low"; evidence_url: string | null }
export interface WhoIdentity {
  candidates?: WhoCandidate[];
  status: "found" | "partial" | "not_found" | "private" | "running" | "error";
  company?: string | null; website?: string | null; person?: string | null; title?: string | null; linkedin?: string | null;
  emails: string[]; phones: string[]; confidence?: "high" | "medium" | "low" | null;
  evidence: { url: string; says: string }[]; note: string; checked_at: string;
}

/** Dates for the radar, in your time zone: "Today, 4:20 pm", "Yesterday, 9:05 am", "Wed 12 Nov, 6:40 pm". */
export function whenLabel(iso: string | Date, tz: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  const time = d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const yest = new Date(now.getTime() - 86_400_000);
  if (day(d) === day(now)) return `Today, ${time}`;
  if (day(d) === day(yest)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

/** "Today", "Yesterday" or "Wednesday 12 November", for the day headers. */
export function dayHeader(iso: string | Date, tz: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  if (day(d) === day(now)) return "Today";
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return d.toLocaleDateString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
}

export function PosterLine({ p }: { p: Poster | null | undefined }) {
  if (!p || (!p.name && !p.username)) return null;
  const where = [p.city, p.country].filter(Boolean).join(", ");
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className="inline-flex items-center gap-1 font-medium"><UserRound className="h-3 w-3 text-subtle" />{p.name ?? p.username}</span>
      {p.name && p.username && p.username !== p.name ? <span className="text-subtle">@{p.username}</span> : null}
      {where ? <span className="inline-flex items-center gap-0.5 text-subtle"><MapPin className="h-3 w-3" />{where}</span> : null}
      {p.history ? <span className="text-subtle">{p.history}</span> : null}
      {p.joined ? <span className="text-subtle">member since {p.joined.slice(0, 4)}</span> : null}
    </p>
  );
}

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Who is behind a post, and how to reach them without the platform: the business, the decision maker, the contact
 * details that business publishes, each with where it was seen. "Find them directly" runs the search.
 */
export function WhoPanel({ itemId, identity, paid, platform }: { itemId: number; identity: WhoIdentity | null | undefined; paid: boolean; platform: string | null }) {
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const running = identity?.status === "running" && Date.now() - new Date(identity.checked_at).getTime() < 3 * 60_000;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => router.refresh(), 4000);
    return () => clearTimeout(t);
  }, [running, router, identity?.checked_at]);

  const find = () => start(async () => {
    const r = await findBehindAction(itemId);
    if (!r.ok) return toast(r.error, "error");
    const id = r.identity;
    toast(id.status === "found" ? `Found ${id.person ?? id.company}` : id.status === "partial" ? "Found part of it" : id.status === "private" ? "Looks like a private person, not a business" : "Could not tie a business to this post");
    router.refresh();
  });

  const id = identity && identity.status !== "running" ? identity : null;
  const hasAny = !!id && (id.company || id.website || id.person || id.emails.length || id.phones.length || id.linkedin);
  return (
    <div className={cn("mt-2 rounded-xl border p-2.5 text-xs", hasAny ? "border-good/30 bg-good/5" : paid ? "border-warn/30 bg-warn/5" : "border-border")} aria-label="Who is behind it">
      {paid && !hasAny ? <p className="mb-1.5"><b>{platform ?? "This site"}</b> needs paid bids or credits to reply. Find the business behind it and reach them directly instead.</p> : null}
      {running || busy ? (
        <p className="flex items-center gap-1.5 text-subtle"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for the business behind this post: searching the web and Google, checking every detail against what it reads. Up to a minute.</p>
      ) : id ? (
        <div className="space-y-1">
          {hasAny ? (
            <>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {id.person ? <span className="inline-flex items-center gap-1 text-sm font-semibold"><UserRound className="h-3.5 w-3.5" /><span>{id.person}{id.title ? <span className="font-normal text-subtle">, {id.title}</span> : null}</span></span> : null}
                {id.company ? <span className="inline-flex items-center gap-1 font-medium"><Building2 className="h-3.5 w-3.5 text-subtle" />{id.company}</span> : null}
                {id.confidence ? <span className={cn("rounded px-1.5 py-0.5 font-medium", id.confidence === "high" ? "bg-p-mint text-p-mint-fg" : id.confidence === "medium" ? "bg-p-sky text-p-sky-fg" : "bg-muted text-subtle")}>{id.confidence === "high" ? "Sure" : id.confidence === "medium" ? "Likely" : "A guess"}</span> : null}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {id.emails.map((e) => <a key={e} href={`mailto:${e}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 hover:border-accent"><Mail className="h-3 w-3" />{e}</a>)}
                {id.phones.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1">
                    <a href={`tel:${p.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 hover:border-accent"><Phone className="h-3 w-3" />{p}</a>
                    <a href={`https://wa.me/${digits(p)}`} target="_blank" rel="noreferrer" className="rounded-md border border-border bg-surface px-2 py-1 hover:border-accent">WhatsApp</a>
                  </span>
                ))}
                {id.linkedin ? <a href={id.linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 hover:border-accent"><Linkedin className="h-3 w-3" />LinkedIn</a> : null}
                {id.website ? <a href={id.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 hover:border-accent"><Globe className="h-3 w-3" />{id.website.replace(/^https?:\/\//, "")}</a> : null}
              </div>
            </>
          ) : null}
          <p className="text-subtle">{id.note}</p>
          {id.candidates?.length ? (
            <div className="rounded-lg border border-border bg-surface p-2" aria-label="Other possible businesses">
              <p className="mb-1 font-semibold">{hasAny ? "Could also be" : "Possible businesses"} ({id.candidates.length})</p>
              <ul className="space-y-1.5">
                {id.candidates.map((c) => (
                  <li key={c.company} className="flex flex-wrap items-start gap-x-2 gap-y-0.5">
                    <span className="font-medium">{c.company}</span>
                    {c.location ? <span className="text-subtle">{c.location}</span> : null}
                    <span className={cn("rounded px-1 text-[10px] font-medium", c.confidence === "high" ? "bg-p-mint text-p-mint-fg" : c.confidence === "medium" ? "bg-p-sky text-p-sky-fg" : "bg-muted text-subtle")}>{c.confidence === "high" ? "Sure" : c.confidence === "medium" ? "Likely" : "A guess"}</span>
                    {c.person ? <span className="text-subtle">{c.person}</span> : null}
                    <span className="w-full text-subtle">{c.why}{c.evidence_url ? <> · <a href={c.evidence_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">source</a></> : null}{c.website ? <> · <a href={c.website} target="_blank" rel="noreferrer" className="text-accent hover:underline">{c.website.replace(/^https?:\/\/(www\.)?/, "")}</a></> : null}</span>
                    <button type="button" className="text-accent hover:underline" onClick={() => start(async () => {
                      const r = await researchLeadAction(itemId, { company: c.company, website: c.website ?? undefined });
                      toast(r.ok ? `Researching ${c.company}: the profile fills in over a few minutes` : r.error, r.ok ? "ok" : "error");
                      router.refresh();
                    })}>Research this one</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {id.evidence.length ? (
            <details>
              <summary className="cursor-pointer text-accent">Where this was found ({id.evidence.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {id.evidence.map((e, i) => <li key={i}>{/^https?:/.test(e.url) ? <a href={e.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{e.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a> : e.url}: {e.says}</li>)}
              </ul>
            </details>
          ) : null}
          {id.status !== "private" ? <button type="button" onClick={find} className="text-accent hover:underline">Search again</button> : null}
        </div>
      ) : (
        <Button size="sm" variant={paid ? "primary" : "outline"} onClick={find}><UserSearch className="h-3.5 w-3.5" /> Find them directly</Button>
      )}
    </div>
  );
}
