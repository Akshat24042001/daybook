"use client";

import { Building2, CheckCircle2, ExternalLink, Globe, Loader2, Mail, MapPin, Phone, RefreshCw, Search, Sparkles, UserRound, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { enrichAction, researchLeadAction, researchViewAction } from "@/app/sales-actions";
import { Button, Field, Input, Sheet } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { Enrichment } from "@/lib/sales/research-fields";
import type { ResearchView } from "@/lib/sales/research";
import { EnrichmentPanel } from "./enrichment-panel";
import { ago } from "./util";

const STEPS: [string, string][] = [["site", "Their website"], ["search", "The web"], ["synth", "The profile"], ["done", "Done"]];
const val = (e: Enrichment | undefined, k: string): string => {
  const v = e?.[k]?.v;
  return v === null || v === undefined || v === "" ? "" : String(v);
};
const list = (s: string) => s.split(/[,;|]\s*/).map((x) => x.trim()).filter(Boolean);
const money = (n: number | null) => (n ? `$${n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : n}` : null);

function Box({ title, icon: Icon, tone, children }: { title: string; icon: React.ComponentType<{ className?: string }>; tone: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-border p-3", tone)}>
      <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><Icon className="h-4 w-4" /> {title}</h4>
      {children}
    </section>
  );
}

/**
 * Everything known about the company and people behind a lead, available at any time, with a live view of the research
 * while it runs. Opens from a radar card; the same profile is on the deal and the account.
 */
export function ResearchSheet({ open, onOpenChange, radarItemId, companyId, title }: { open: boolean; onOpenChange: (o: boolean) => void; radarItemId?: number; companyId?: number; title: string }) {
  const { toast } = useToast();
  const [view, setView] = useState<ResearchView | null>(null);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState({ company: "", website: "" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const r = await researchViewAction({ radarItemId, companyId });
    if (r.ok) setView(r.view);
    return r.ok ? r.view : null;
  }, [radarItemId, companyId]);

  // load on open, then keep refreshing while anything is running
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const tick = async () => {
      const v = await load();
      if (alive && v?.running) timer.current = setTimeout(tick, 3500);
    };
    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, load]);

  const start = async () => {
    setBusy(true);
    const r = radarItemId
      ? await researchLeadAction(radarItemId, { company: fix.company || undefined, website: fix.website || undefined })
      : companyId ? await enrichAction("company", companyId, true) : { ok: false as const, error: "Nothing to research." };
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Research started. Watch it work below.");
    const v = await load();
    if (v?.running) timer.current = setTimeout(async function again() { const x = await load(); if (x?.running) timer.current = setTimeout(again, 3500); }, 3500);
  };

  const co = view?.company ?? null;
  const e = co?.enrichment;
  const companyRun = view?.runs.find((r) => r.subject === "company");
  const active = view?.runs.find((r) => r.status === "queued" || r.status === "running");
  const lastError = !active && view?.runs[0]?.status === "error" ? view.runs[0] : null;
  const emails = list(val(e, "public_emails"));
  const phones = list(val(e, "public_phones"));
  const socials = val(e, "social_profiles").split(/;\s*/).map((s) => { const i = s.indexOf(": "); return i > 0 ? [s.slice(0, i), s.slice(i + 2)] as const : null; }).filter((x): x is readonly [string, string] => !!x);
  const sources = (view?.runs ?? []).flatMap((r) => r.sources).filter((s, i, a) => a.findIndex((x) => (x.url ?? x.label) === (s.url ?? s.label)) === i);
  const stepIdx = active ? Math.max(0, STEPS.findIndex(([k]) => k === active.stage)) : STEPS.length - 1;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={co?.name ?? title} description={co ? [co.industry, co.country].filter(Boolean).join(" · ") || "Company research" : "Company and people research"} wide>
      <div className="space-y-3">
        {!view ? <p className="py-8 text-center text-sm text-subtle"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</p> : null}

        {active ? (
          <section className="rounded-2xl bg-p-sky p-3 text-p-sky-fg">
            <div className="flex items-center gap-2 text-sm font-semibold"><Loader2 className="h-4 w-4 animate-spin" /> Researching… {STEPS[stepIdx]?.[1]}</div>
            <ol className="mt-2 flex gap-1.5">
              {STEPS.slice(0, 3).map(([k, l], i) => (
                <li key={k} className={cn("flex-1 rounded-full px-2 py-1 text-center text-xs font-medium", i < stepIdx ? "bg-good text-good-on" : i === stepIdx ? "bg-surface/80 shadow-[var(--shadow-sm)]" : "bg-surface/40 opacity-70")}>{l}</li>
              ))}
            </ol>
            <ul className="mt-2 space-y-0.5 text-xs">{active.log.slice(-5).map((l, i) => <li key={i}>· {l}</li>)}</ul>
          </section>
        ) : null}
        {lastError ? <p className="rounded-2xl bg-p-rose px-3 py-2 text-sm text-p-rose-fg">{lastError.error}</p> : null}

        {view && !co && !active ? (
          <Box title="Who is this lead about?" icon={Building2} tone="bg-p-butter text-p-butter-fg">
            <p className="mb-2 text-xs">Type the company name or website and the research starts: the company, its contact details, and the people behind it.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Company name"><Input value={fix.company} onChange={(ev) => setFix({ ...fix, company: ev.target.value })} placeholder="Acme Logistics" /></Field>
              <Field label="Website"><Input value={fix.website} onChange={(ev) => setFix({ ...fix, website: ev.target.value })} placeholder="acmelogistics.com" /></Field>
            </div>
            <Button className="mt-3" variant="primary" disabled={busy || (!fix.company && !fix.website)} onClick={start}><Sparkles className="h-4 w-4" /> Research it</Button>
          </Box>
        ) : null}

        {co ? (
          <>
            <Box title="The company" icon={Building2} tone="bg-p-sky text-p-sky-fg">
              <div className="flex flex-wrap gap-1.5 text-xs">
                {co.website ? <a href={co.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-surface/70 px-2.5 py-1 font-medium"><Globe className="h-3 w-3" /> {co.domain ?? co.website} <ExternalLink className="h-3 w-3" /></a> : null}
                {co.employees ? <span className="rounded-full bg-surface/70 px-2.5 py-1">{co.employees.toLocaleString()} people</span> : null}
                {money(co.revenue_usd) ? <span className="rounded-full bg-surface/70 px-2.5 py-1">≈{money(co.revenue_usd)} a year{e?.revenue_usd?.est !== false ? " (estimate)" : ""}</span> : null}
                {val(e, "founded_year") ? <span className="rounded-full bg-surface/70 px-2.5 py-1">since {val(e, "founded_year")}</span> : null}
                {val(e, "domain_age_years") ? <span className="rounded-full bg-surface/70 px-2.5 py-1">domain {val(e, "domain_age_years")} yrs old</span> : null}
                {val(e, "email_provider") ? <span className="rounded-full bg-surface/70 px-2.5 py-1">email on {val(e, "email_provider")}</span> : null}
              </div>
              {val(e, "summary") ? <p className="mt-2 text-sm text-fg">{val(e, "summary")}</p> : <p className="mt-2 text-sm">{active ? "The profile is being written…" : "Not researched yet."}</p>}
              {val(e, "best_entry_offer") ? <p className="mt-2 rounded-xl bg-surface/70 px-3 py-2 text-xs text-fg"><b>Best first offer:</b> {val(e, "best_entry_offer")}</p> : null}
              {val(e, "pain_points") ? <p className="mt-1.5 rounded-xl bg-surface/70 px-3 py-2 text-xs text-fg"><b>Likely pain:</b> {val(e, "pain_points")}</p> : null}
              {val(e, "money_leak_estimate") ? <p className="mt-1.5 rounded-xl bg-surface/70 px-3 py-2 text-xs text-fg"><b>What it costs them:</b> {val(e, "money_leak_estimate")}</p> : null}
            </Box>

            {emails.length || phones.length || socials.length || val(e, "address") ? (
              <Box title="How to reach them" icon={Mail} tone="bg-p-peach text-p-peach-fg">
                <ul className="space-y-1 text-sm text-fg">
                  {emails.map((m) => <li key={m} className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 shrink-0" /><a className="break-all underline-offset-2 hover:underline" href={`mailto:${m}`}>{m}</a></li>)}
                  {phones.map((p) => <li key={p} className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0" /><a className="hover:underline" href={`tel:${p.replace(/[^\d+]/g, "")}`}>{p}</a></li>)}
                  {val(e, "address") ? <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{val(e, "address")}</li> : null}
                </ul>
                {socials.length ? <div className="mt-2 flex flex-wrap gap-1.5">{socials.map(([k, u]) => <a key={k} href={u} target="_blank" rel="noreferrer" className="rounded-full bg-surface/70 px-2.5 py-1 text-xs font-medium capitalize">{k} ↗</a>)}</div> : null}
                <p className="mt-2 text-xs">Taken from their own website. Nothing here is guessed.</p>
              </Box>
            ) : null}

            <Box title={`The people (${view?.people.length ?? 0})`} icon={Users} tone="bg-p-lilac text-p-lilac-fg">
              {view?.people.length ? (
                <ul className="space-y-2">
                  {view.people.map((p) => {
                    const pe = p.enrichment;
                    const found = p.emails[0] ?? val(pe, "email_found");
                    const guess = val(pe, "email_guess");
                    return (
                      <li key={p.id} className="rounded-xl bg-surface/80 p-3 text-fg">
                        <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold"><UserRound className="h-4 w-4" /> {p.full_name}{p.is_decision_maker ? <span className="rounded-full bg-good px-2 py-0.5 text-[10px] font-semibold text-good-on">decision maker</span> : null}</p>
                        <p className="text-xs text-subtle">{p.title ?? val(pe, "current_title") ?? "Role unknown"}{p.enriched_at ? ` · researched ${ago(p.enriched_at)}` : " · not researched yet"}</p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          {found ? <a href={`mailto:${found}`} className="inline-flex items-center gap-1 hover:underline"><Mail className="h-3 w-3" /> {found}</a> : guess ? <span className="inline-flex items-center gap-1" title={val(pe, "email_pattern_basis")}><Mail className="h-3 w-3" /> {guess} <span className="rounded bg-warn-muted px-1 text-[10px] text-warn">guess, unverified</span></span> : null}
                          {p.linkedin ? <a href={p.linkedin} target="_blank" rel="noreferrer" className="hover:underline">LinkedIn ↗</a> : null}
                        </div>
                        {val(pe, "opener") ? <p className="mt-1.5 rounded-lg bg-p-sky px-2.5 py-1.5 text-xs text-p-sky-fg">💬 {val(pe, "opener")}</p> : null}
                        {val(pe, "what_they_care_about") ? <p className="mt-1 text-xs"><b>Cares about:</b> {val(pe, "what_they_care_about")}</p> : null}
                        {p.enriched_at ? (
                          <details className="mt-1.5"><summary className="cursor-pointer text-xs font-semibold">Everything about {p.full_name.split(" ")[0]}</summary>
                            <div className="mt-2"><EnrichmentPanel kind="person" id={p.id} data={pe} groups={view.groups.person} enrichedAt={p.enriched_at} title={p.full_name} /></div>
                          </details>
                        ) : (
                          <Button size="sm" variant="outline" className="mt-2" onClick={async () => { const r = await enrichAction("person", p.id, true); toast(r.ok ? "Researching this person" : r.error, r.ok ? "ok" : "error"); void load(); }}><Search className="h-3.5 w-3.5" /> Research this person</Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-sm">{active ? "Looking for the people behind the company…" : "No named people found yet."}</p>}
            </Box>

            {view && co.enriched_at ? (
              <details className="rounded-2xl border border-border bg-surface/70 p-3">
                <summary className="cursor-pointer text-sm font-semibold">All {Object.values(co.enrichment ?? {}).filter((f) => f?.v !== null && f?.v !== undefined && f?.v !== "").length} facts about the company</summary>
                <div className="mt-3"><EnrichmentPanel kind="company" id={co.id} data={co.enrichment} groups={view.groups.company} enrichedAt={co.enriched_at} title={co.name} /></div>
              </details>
            ) : null}
          </>
        ) : null}

        {sources.length ? (
          <details className="rounded-2xl border border-border bg-surface/70 p-3">
            <summary className="cursor-pointer text-sm font-semibold">Where this came from ({sources.length} sources)</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {sources.map((s, i) => (
                <li key={i} className="flex gap-2"><span className="w-16 shrink-0 text-subtle">{s.kind}</span>{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline">{s.label}</a> : <span>{s.label}</span>}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {view?.runs.length ? (
          <details className="rounded-2xl border border-border bg-surface/70 p-3">
            <summary className="cursor-pointer text-sm font-semibold">What the researcher did</summary>
            <ul className="mt-2 space-y-2 text-xs">
              {view.runs.map((r) => (
                <li key={r.id}><b>{r.subject === "company" ? "Company" : "Person"} research</b> · {r.status} · {ago(r.started_at)}<ul className="mt-0.5 text-subtle">{r.log.map((l, i) => <li key={i}>· {l}</li>)}</ul></li>
              ))}
            </ul>
          </details>
        ) : null}

        {co ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button variant="outline" disabled={busy || !!active} onClick={start}>{busy || active ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Research again</Button>
            {companyRun?.finished_at ? <span className="flex items-center gap-1 text-xs text-subtle"><CheckCircle2 className="h-3.5 w-3.5 text-good" /> Last finished {ago(companyRun.finished_at)}</span> : null}
            {radarItemId ? (
              <details className="ml-auto text-xs"><summary className="cursor-pointer text-subtle">Wrong company?</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input value={fix.company} onChange={(ev) => setFix({ ...fix, company: ev.target.value })} placeholder="Company name" className="h-9 w-40 text-xs" />
                  <Input value={fix.website} onChange={(ev) => setFix({ ...fix, website: ev.target.value })} placeholder="website" className="h-9 w-40 text-xs" />
                  <Button size="sm" variant="primary" disabled={busy || (!fix.company && !fix.website)} onClick={start}>Research this instead</Button>
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
