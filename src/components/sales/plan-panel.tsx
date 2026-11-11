"use client";
import { InfoTip } from "@/components/info-tip";

import { Check, CircleAlert, Search } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { describeSchedule } from "@/lib/sales/hunt-schedule";
import { CATEGORY_HELP } from "@/lib/sales/radar-help";
import type { RadarPlan } from "@/lib/sales/radar-plan";
import { ago } from "./util";

function Section({ title, hint, info, tone = "teal", children }: { title: string; hint?: string; info?: string; tone?: "teal" | "lilac" | "peach" | "sky" | "mint"; children: React.ReactNode }) {
  const bar = { teal: "bg-teal-fill", lilac: "bg-lilac-fill", peach: "bg-peach-fill", sky: "bg-accent", mint: "bg-good" }[tone];
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <span className={cn("mb-2 block h-1 w-8 rounded-full", bar)} aria-hidden />
      <h3 className="flex items-center gap-1 text-sm font-semibold">{title}{info ? <InfoTip label={`About ${title}`}>{info}</InfoTip> : null}</h3>
      {hint ? <p className="mb-3 mt-0.5 text-xs text-subtle">{hint}</p> : <div className="mb-2" />}
      {children}
    </section>
  );
}

const when = (iso: string | null, tz: string) => (iso ? new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz }) : "soon");

export function PlanPanel({ plan }: { plan: RadarPlan }) {
  const [cat, setCat] = useState<string>("all");
  const [onlyOn, setOnlyOn] = useState(true);
  const cats = [...new Set(plan.sources.map((s) => s.category))];
  const sources = plan.sources.filter((s) => (cat === "all" || s.category === cat) && (!onlyOn || s.enabled));
  const s = plan.searches;
  const paidLeft = Math.max(0, s.cap - s.paid24h);
  const missing = plan.platforms.filter((p) => !p.on && p.hint);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-p-teal px-4 py-3 text-sm text-p-teal-fg">
        <p className="font-semibold">Right now the radar is targeting <b>{plan.now.country}</b>, in <b>{plan.now.industry}</b>.</p>
        <p className="mt-1 text-xs"><b>Why {plan.now.country}:</b> {plan.targeting.why.country.reason}</p>
        <p className="mt-0.5 text-xs"><b>Why {plan.now.industry}:</b> {plan.targeting.why.industry.reason}</p>
        <p className="mt-1 text-xs">
          It sweeps its feeds every {plan.rhythm.sweepEveryMin} minutes, scores every result against your offers, keeps anything from {plan.rhythm.minScore}/100 up, alerts you on Telegram from {plan.rhythm.alertScore}/100,
          and every morning at {String(plan.rhythm.digestHour).padStart(2, "0")}:00 guarantees at least {plan.rhythm.dailyMin} qualified lead{plan.rhythm.dailyMin === 1 ? "" : "s"} or tells you honestly that there were none.
        </p>
      </div>

      {missing.length ? (
        <div className="flex gap-2 rounded-2xl bg-p-butter px-4 py-3 text-xs text-p-butter-fg">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p><b>Not set up yet:</b> {missing.map((m) => `${m.name} (${m.hint})`).join(" · ")}. The radar works without them but finds less.</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section tone="lilac" title="Where it will look in the next 7 days" hint={plan.targeting.mode === "adaptive"
          ? `Adaptive: each week's country and each day's industry are chosen on the day from results, ${plan.targeting.explorePct}% of turns explore the least-tested option. Greyed entries are the likeliest pick, not yet decided.`
          : "Even rotation: countries change weekly and industries daily, in list order. Switch to adaptive in Sales > Settings."}>
          <ul className="divide-y divide-border text-sm">
            {plan.rotation.map((r) => (
              <li key={r.date} className={cn("flex items-center gap-3 py-1.5", r.today && "font-medium")}>
                <span className="w-24 shrink-0 text-xs text-subtle">{r.today ? "Today" : new Date(`${r.date}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</span>
                <span className={cn("min-w-0 flex-1 truncate", !r.countryDecided && "italic text-subtle")} title={r.countryDecided ? undefined : "Likeliest; decided on Monday"}>{r.country}</span>
                <span className={cn("min-w-0 flex-1 truncate text-right", r.industryDecided ? "text-subtle" : "italic text-subtle/70")} title={r.industryDecided ? undefined : "Likeliest; decided that morning"}>{r.industry}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section tone="sky" title="Search spending" hint="Paid providers stop at your daily cap, then the weaker free search takes over.">
          <p className="text-sm"><b className="font-display text-2xl tabular">{s.paid24h}</b> <span className="text-subtle">of {s.cap} paid searches used in the last 24 hours ({paidLeft} left)</span></p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", s.paid24h >= s.cap ? "bg-bad" : "bg-accent")} style={{ width: `${Math.min(100, (s.paid24h / Math.max(1, s.cap)) * 100)}%` }} /></div>
          <p className="mt-2 text-xs text-subtle">
            {s.used24h} searches in total in 24 hours{s.byProvider.length ? ` (${s.byProvider.map((b) => `${b.provider} ${b.n}`).join(", ")})` : ""} · {s.month} in 30 days.
          </p>
        </Section>
      </div>

      <Section tone="teal" title="What each market has brought in (120 days)" hint="Points per turn as the focus." info="Points: 1 per qualified lead, 3 per conversation, 10 per deal won. The score is points per turn as the focus, so heavily targeted markets must keep earning their place.">
        <div className="grid gap-4 lg:grid-cols-2">
          {([["Countries", plan.targeting.countries], ["Industries", plan.targeting.industries]] as const).map(([label, rows]) => (
            <div key={label} className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-subtle"><th className="py-1 font-medium">{label}</th><th className="py-1 text-right font-medium">Leads</th><th className="py-1 text-right font-medium">Talks</th><th className="py-1 text-right font-medium">Won</th><th className="py-1 text-right font-medium">Turns</th><th className="py-1 text-right font-medium">Score</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {rows.map((w) => (
                    <tr key={w.value} className={cn(w.value === plan.now.country || w.value === plan.now.industry ? "font-medium" : "")}>
                      <td className="py-1 pr-2">{w.value}</td>
                      <td className="tabular py-1 text-right">{w.qualified}</td>
                      <td className="tabular py-1 text-right">{w.conversations}</td>
                      <td className="tabular py-1 text-right">{w.won}</td>
                      <td className="tabular py-1 text-right text-subtle">{w.turns}</td>
                      <td className="tabular py-1 text-right">{w.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="peach" title="Platforms and services in use" hint="Green is working. Grey needs a key or a setting.">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {plan.platforms.map((p) => (
            <li key={p.name} className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-xs">
              <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full", p.on ? "bg-good text-good-on" : "bg-border text-subtle")}>{p.on ? <Check className="h-3 w-3" /> : null}</span>
              <span><b className="block text-sm">{p.name}</b><span className="text-subtle">{p.role}</span>{!p.on && p.hint ? <span className="block text-p-butter-fg">{p.hint}</span> : null}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="mint" title={`Your hunts (${plan.hunts.filter((h) => h.enabled).length} on)`} hint="AI hunts you set up under the Hunts tab.">
        {plan.hunts.length === 0 ? <p className="text-sm text-subtle">No hunts yet.</p> : (
          <ul className="space-y-2">
            {plan.hunts.map((h) => (
              <li key={h.id} className={cn("rounded-xl border border-border px-3 py-2 text-sm", !h.enabled && "opacity-60")}>
                <p className="font-medium">{h.name} <span className="text-xs font-normal text-p-lilac-fg">· {describeSchedule(h)}{h.enabled ? ` · next ${when(h.next_run_at, plan.timezone)}` : " · paused"}</span></p>
                <p className="mt-0.5 text-xs text-subtle">
                  Looks for: {h.signals.join(", ")} · countries: {h.countries.length ? h.countries.join(", ") : "this week's rotation"} · industries: {h.industries.length ? h.industries.join(", ") : "today's rotation"}
                  {h.keywords.length ? ` · always searches: ${h.keywords.map((k) => `“${k}”`).join(", ")}` : ""}
                </p>
                {h.brief ? <p className="mt-0.5 line-clamp-2 text-xs">{h.brief}</p> : null}
                {h.last_run?.queries.length ? <details className="mt-1"><summary className="cursor-pointer text-xs text-subtle">Queries from its last run ({h.last_run.queries.length})</summary><ul className="mt-1 list-disc pl-4 text-xs text-subtle">{h.last_run.queries.map((x, i) => <li key={i}>{x}</li>)}</ul></details> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section tone="teal" title="Every source, and what it looks at today" hint="These sweep automatically on their own schedule, with this week's country and today's industry filled in.">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {["all", ...cats].map((c) => (
            <button key={c} type="button" onClick={() => setCat(c)} className={cn("rounded-md border px-2.5 py-1 text-xs", cat === c ? "border-transparent bg-p-teal text-p-teal-fg" : "border-border text-subtle")}>{c}</button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-subtle"><input type="checkbox" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} /> Only sources that are on</label>
        </div>
        {cat !== "all" && CATEGORY_HELP[cat] ? <p className="mb-2 rounded-xl bg-muted px-3 py-2 text-xs text-subtle">{CATEGORY_HELP[cat]}</p> : null}
        <ul className="divide-y divide-border">
          {sources.map((x) => (
            <li key={x.id} className="py-2 text-xs">
              <p className="flex flex-wrap items-baseline gap-x-2"><b className={cn("text-sm", !x.enabled && "text-subtle")}>{x.name}</b><span className="rounded-md bg-muted px-1.5 py-0.5 text-subtle">{x.category}</span>{!x.enabled ? <span className="text-subtle">off</span> : null}</p>
              <p className="break-words text-subtle">{x.target}</p>
              <p className="text-subtle">
                {x.kind === "email" ? "Runs when an email arrives" : `Every ${x.interval_hours}h · last ${x.last_run_at ? ago(x.last_run_at) : "never"}${x.next_run_at ? ` · next ${when(x.next_run_at, plan.timezone)}` : ""}`}
                {" · "}{x.items_found} found, {x.items_qualified} qualified
              </p>
              {x.last_error ? <p className="text-bad">{x.last_error.slice(0, 160)}</p> : null}
            </li>
          ))}
          {sources.length === 0 ? <li className="py-3 text-sm text-subtle">No sources match.</li> : null}
        </ul>
      </Section>

      <Section tone="sky" title="Searches that actually ran" hint="The last 60 web searches." info="Newest first: which engine, exactly what was asked, how many results, and who asked.">
        {plan.recent.length === 0 ? <p className="text-sm text-subtle">None yet. They appear as soon as the radar or a hunt runs.</p> : (
          <ul className="divide-y divide-border">
            {plan.recent.map((r, i) => (
              <li key={i} className="flex gap-2 py-1.5 text-xs">
                <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" />
                <span className="min-w-0 flex-1">
                  <span className="break-words font-medium">{r.query}</span>
                  <span className="block text-subtle">{r.provider} · {ago(r.at)} · {r.error ? <span className="text-bad">{r.error}</span> : `${r.hits} result${r.hits === 1 ? "" : "s"}`}{r.label ? ` · ${r.label}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
