"use client";

import { ArrowDown, ArrowUp, Columns3, Filter, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { bulkDealsAction } from "@/app/sales-actions";
import { Button, Input, Select, Sheet } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { DealCard } from "@/lib/sales/deals";
import { DEAL_TYPES, qualification, SOURCES as SOURCES_LIST, type FieldDef } from "@/lib/sales/fields";
import type { Stage } from "@/lib/sales/stages";
import { ago, money, Priority } from "./util";

const D = 86_400_000;
const fmtDay = (v: unknown) => (v ? new Date(String(v).length <= 10 ? `${String(v).slice(0, 10)}T12:00:00` : String(v)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

export interface Column {
  key: string;
  label: string;
  render: (d: DealCard) => React.ReactNode;
  /** for sorting; strings sort alphabetically, numbers numerically */
  sort: (d: DealCard) => string | number;
  right?: boolean;
}

type Named = { id: number; name: string };

function columnsFor(stages: Stage[], customDefs: FieldDef[], team: Named[] = [], pipelines: Named[] = []): Column[] {
  const stage = (d: DealCard) => stages.find((x) => x.id === d.stage_id);
  const text = (k: keyof DealCard, label: string): Column => ({
    key: String(k), label,
    render: (d) => { const v = d[k]; return Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v); },
    sort: (d) => { const v = d[k]; return (Array.isArray(v) ? v.join(", ") : String(v ?? "")).toLowerCase(); },
  });
  const base: Column[] = [
    { key: "priority", label: "Priority", render: (d) => <Priority value={d.priority} prev={d.priority_prev} why={d.priority_why} />, sort: (d) => d.priority },
    { key: "fit", label: "Fit", right: true, render: (d) => (d.fit ? `${d.fit.grade} · ${d.fit.score}` : ""), sort: (d) => d.fit?.score ?? -1 },
    { key: "owner", label: "Owner", render: (d) => team.find((t) => t.id === d.owner_id)?.name ?? "", sort: (d) => (team.find((t) => t.id === d.owner_id)?.name ?? "").toLowerCase() },
    { key: "pipeline", label: "Pipeline", render: (d) => pipelines.find((p) => p.id === d.pipeline_id)?.name ?? "", sort: (d) => (pipelines.find((p) => p.id === d.pipeline_id)?.name ?? "").toLowerCase() },
    { key: "recurring", label: "Recurring", right: true, render: (d) => (d.recurring_amount ? `${money(Number(d.recurring_amount), d.currency)}/${d.billing_cycle === "yearly" ? "yr" : d.billing_cycle === "quarterly" ? "qtr" : "mo"}` : ""), sort: (d) => Number(d.recurring_amount ?? 0) },
    { key: "contract_end", label: "Contract ends", render: (d) => fmtDay(d.contract_end), sort: (d) => (d.contract_end ? +new Date(d.contract_end) : Number.MAX_SAFE_INTEGER) },
    { key: "why", label: "Why this priority", render: (d) => <span className="text-subtle">{(d.priority_why ?? []).slice(0, 3).join(" · ")}</span>, sort: (d) => d.priority },
    { key: "stage", label: "Stage", render: (d) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: stage(d)?.color }} />{d.stage_name}</span>, sort: (d) => stage(d)?.sort ?? 0 },
    { key: "value", label: "Value", right: true, render: (d) => (d.value_amount ? money(Number(d.value_amount), d.currency) : ""), sort: (d) => Number(d.value_usd ?? 0) },
    { key: "probability", label: "Win chance", right: true, render: (d) => `${d.probability ?? d.stage_probability}%`, sort: (d) => d.probability ?? d.stage_probability },
    { key: "next", label: "Next step", render: (d) => (d.next_action ? <span>{d.next_action}{d.next_action_at ? <span className="block text-subtle">{fmtDay(d.next_action_at)}</span> : null}</span> : <span className="text-warn">none</span>), sort: (d) => (d.next_action_at ? +new Date(d.next_action_at) : Number.MAX_SAFE_INTEGER) },
    { key: "touch", label: "Last touch", render: (d) => (d.last_touch_at ? ago(d.last_touch_at) : "never"), sort: (d) => (d.last_touch_at ? +new Date(d.last_touch_at) : 0) },
    { key: "in_stage", label: "Days in stage", right: true, render: (d) => Math.floor((Date.now() - +new Date(d.stage_changed_at)) / D), sort: (d) => +new Date(d.stage_changed_at) * -1 },
    { key: "expected_close", label: "Expected close", render: (d) => fmtDay(d.expected_close), sort: (d) => (d.expected_close ? +new Date(d.expected_close) : Number.MAX_SAFE_INTEGER) },
    { key: "deal_type", label: "Type", render: (d) => DEAL_TYPES.find(([k]) => k === d.deal_type)?.[1] ?? "", sort: (d) => d.deal_type ?? "" },
    text("source", "Source"),
    text("city", "City"),
    text("region", "State / region"),
    text("country", "Country"),
    text("industry", "Industry"),
    text("services", "Services"),
    text("tags", "Tags"),
    text("budget", "Budget"),
    text("timeline", "Their timeline"),
    text("competitors", "Competitors"),
    { key: "qual", label: "Qualified", right: true, render: (d) => { const q = qualification(d as unknown as Record<string, unknown>); return `${q.done}/${q.total}`; }, sort: (d) => qualification(d as unknown as Record<string, unknown>).done },
    { key: "outcome", label: "Won / lost reason", render: (d) => d.won_reason ?? d.lost_reason ?? "", sort: (d) => (d.won_reason ?? d.lost_reason ?? "").toLowerCase() },
    { key: "created", label: "Created", render: (d) => fmtDay(d.created_at), sort: (d) => +new Date(d.created_at) },
  ];
  const custom: Column[] = customDefs.map((c) => {
    const k = c.key.replace(/^custom\./, "");
    const val = (d: DealCard) => (d.custom ?? {})[k];
    return {
      key: c.key, label: c.label,
      render: (d) => { const v = val(d); return v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : c.type === "date" ? fmtDay(v) : c.type === "money" ? money(Number(v)) : String(v); },
      sort: (d) => { const v = val(d); return typeof v === "number" ? v : String(v ?? "").toLowerCase(); },
      right: c.type === "number" || c.type === "money",
    };
  });
  return [...base, ...custom];
}

const DEFAULT_COLS = ["priority", "fit", "stage", "value", "next", "touch", "city", "source"];
const COLS_KEY = "sales-pipeline-columns";

/** The deal list as a table: pick any columns (your own fields included), sort by any of them. */
export function DealTable({ deals, stages, customDefs, team = [], pipelines = [], transitions = [] }: {
  deals: DealCard[]; stages: Stage[]; customDefs: FieldDef[]; team?: Named[]; pipelines?: Named[]; transitions?: { from_stage: number; to_stage: number; requires: string }[];
}) {
  const all = useMemo(() => columnsFor(stages, customDefs, team, pipelines), [stages, customDefs, team, pipelines]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const visibleIds = deals.map((d) => d.id);
  const sel = visibleIds.filter((id) => picked.has(id));
  void transitions;
  const [shown, setShown] = useState<string[]>(DEFAULT_COLS);
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: "priority", desc: true });
  const [pick, setPick] = useState(false);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "null");
      if (Array.isArray(v) && v.length) setShown(v.filter((k) => typeof k === "string"));
    } catch {
      /* private mode */
    }
  }, []);
  const save = (next: string[]) => {
    setShown(next);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };
  const cols = shown.map((k) => all.find((c) => c.key === k)).filter(Boolean) as Column[];
  const sortCol = all.find((c) => c.key === sort.key) ?? all[0];
  const rows = [...deals].sort((a, b) => {
    const x = sortCol.sort(a);
    const y = sortCol.sort(b);
    const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sort.desc ? -r : r;
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {sel.length ? <BulkBar ids={sel} stages={stages} team={team} pipelines={pipelines} onDone={() => setPicked(new Set())} /> : <span className="mr-auto text-xs text-subtle">Tick deals to change many at once.</span>}
        <Button size="sm" variant="outline" onClick={() => setPick(true)}><Columns3 className="h-3.5 w-3.5" /> Columns ({cols.length})</Button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-subtle">
            <tr>
              <th className="w-8 p-2"><input type="checkbox" aria-label="Select all" checked={sel.length > 0 && sel.length === visibleIds.length} onChange={(e) => setPicked(e.target.checked ? new Set(visibleIds) : new Set())} /></th>
              <th className="p-2">#</th>
              <th className="p-2">Deal</th>
              {cols.map((c) => (
                <th key={c.key} className={cn("p-2 whitespace-nowrap", c.right && "text-right")}>
                  <button type="button" className="inline-flex items-center gap-0.5 hover:text-fg" onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                    {c.label}{sort.key === c.key ? (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={d.id} className={cn("border-t border-border align-top hover:bg-muted/40", picked.has(d.id) && "bg-accent/5")}>
                <td className="p-2"><input type="checkbox" aria-label={`Select ${d.title}`} checked={picked.has(d.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} /></td>
                <td className="p-2 text-xs tabular text-subtle">{i + 1}</td>
                <td className="min-w-[200px] p-2"><Link href={`/sales/deal/${d.id}`} className="font-medium hover:text-accent">{d.title}</Link><p className="text-xs text-subtle">{[d.person_name, d.company_name].filter(Boolean).join(" · ")}</p></td>
                {cols.map((c) => <td key={c.key} className={cn("p-2 text-xs", c.right && "text-right tabular")}>{c.render(d)}</td>)}
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={cols.length + 3} className="p-4 text-center text-sm text-subtle">No deals match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <Sheet open={pick} onOpenChange={setPick} title="Columns" description="Tick what to show. Click a column's name in the table to sort by it.">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {all.map((c) => (
            <label key={c.key} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
              <input type="checkbox" checked={shown.includes(c.key)} onChange={(e) => save(e.target.checked ? [...shown, c.key] : shown.filter((k) => k !== c.key))} />
              {c.label}
            </label>
          ))}
        </div>
        <div className="mt-3 flex justify-between">
          <Button variant="ghost" size="sm" onClick={() => save(DEFAULT_COLS)}>Reset</Button>
          <Button variant="primary" size="sm" onClick={() => setPick(false)}>Done</Button>
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- bulk changes

const BULK_SET: [string, string][] = [
  ["stage", "Move to stage"], ["pipeline_id", "Pipeline"], ["owner_id", "Owner"], ["source", "Source"], ["deal_type", "Type"],
  ["city", "City"], ["region", "State / region"], ["country", "Country"], ["industry", "Industry"], ["expected_close", "Expected close"], ["add_tags", "Add tags"],
];

function BulkBar({ ids, stages, team, pipelines, onDone }: { ids: number[]; stages: Stage[]; team: Named[]; pipelines: Named[]; onDone: () => void }) {
  const [what, setWhat] = useState("");
  const [value, setValue] = useState("");
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const choices: Record<string, [string, string][]> = {
    stage: stages.filter((s) => s.category === "open").map((s) => [String(s.id), s.name]),
    pipeline_id: pipelines.map((p) => [String(p.id), p.name]),
    owner_id: team.map((t) => [String(t.id), t.name]),
    source: SOURCES_LIST.map((s) => [s, s]),
    deal_type: DEAL_TYPES,
  };
  const run = (op: Parameters<typeof bulkDealsAction>[1], label: string) => start(async () => {
    const r = await bulkDealsAction(ids, op);
    if (!r.ok) return toast(r.error, "error");
    const f = r.result.failed;
    toast(f.length ? `${label}: ${r.result.done} done, ${f.length} not (${f[0].title}: ${f[0].error})` : `${label}: ${r.result.done} done`, f.length ? "error" : undefined);
    onDone();
    setWhat("");
    setValue("");
    router.refresh();
  });
  const apply = () => {
    if (!what || !value.trim()) return toast("Pick what to change and the new value.", "error");
    if (what === "stage") return run({ stage_id: Number(value) }, "Moved");
    if (what === "add_tags") return run({ add_tags: value.split(",").map((x) => x.trim()).filter(Boolean) }, "Tagged");
    return run({ set: { [what]: what === "pipeline_id" || what === "owner_id" ? Number(value) : value } }, "Updated");
  };
  return (
    <div className="mr-auto flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-2 py-1.5" role="group" aria-label="Bulk changes">
      <span className="text-xs font-medium">{ids.length} selected</span>
      <Select value={what} onChange={(e) => { setWhat(e.target.value); setValue(""); }} aria-label="Change" className="h-8 w-40 text-xs">
        <option value="">Change…</option>
        {BULK_SET.filter(([k]) => !choices[k] || choices[k].length).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      {what ? (choices[what] ? (
        <Select value={value} onChange={(e) => setValue(e.target.value)} aria-label="New value" className="h-8 w-44 text-xs">
          <option value="">Pick…</option>
          {choices[what].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      ) : (
        <Input type={what === "expected_close" ? "date" : "text"} value={value} onChange={(e) => setValue(e.target.value)} aria-label="New value" className="h-8 w-44 text-xs" placeholder={what === "add_tags" ? "hot, Q1" : ""} />
      )) : null}
      <Button size="sm" variant="primary" disabled={busy || !what} onClick={apply}>Apply</Button>
      <Button size="sm" variant="ghost" className="text-bad" disabled={busy} onClick={() => confirm(`Delete ${ids.length} deal${ids.length === 1 ? "" : "s"} and their whole history?`) && run({ delete: true }, "Deleted")}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
      <Button size="sm" variant="ghost" onClick={onDone}>Clear</Button>
    </div>
  );
}

// ---------------------------------------------------------------- filters (board and list)

export interface Filters {
  source: string;
  deal_type: string;
  city: string;
  country: string;
  tag: string;
  service: string;
  close: "" | "this_month" | "overdue" | "none";
  stale: "" | "7" | "14" | "30";
  qual: "" | "low";
  owner: string;
  fit: "" | "A" | "AB" | "CD";
}
export const NO_FILTERS: Filters = { source: "", deal_type: "", city: "", country: "", tag: "", service: "", close: "", stale: "", qual: "", owner: "", fit: "" };

export function applyFilters(list: DealCard[], f: Filters): DealCard[] {
  const now = Date.now();
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59).getTime();
  const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  return list.filter((d) => {
    if (f.source && d.source !== f.source) return false;
    if (f.deal_type && (d.deal_type ?? "new") !== f.deal_type) return false;
    if (f.city && lc(d.city) !== lc(f.city)) return false;
    if (f.country && lc(d.country) !== lc(f.country)) return false;
    if (f.tag && !(d.tags ?? []).some((t) => lc(t) === lc(f.tag))) return false;
    if (f.service && !(d.services ?? []).some((t) => lc(t) === lc(f.service))) return false;
    if (f.close) {
      const c = d.expected_close ? +new Date(`${String(d.expected_close).slice(0, 10)}T12:00:00`) : null;
      if (f.close === "none" && c !== null) return false;
      if (f.close === "this_month" && (c === null || c > monthEnd || c < now - 31 * D)) return false;
      if (f.close === "overdue" && (c === null || c >= now - D / 2)) return false;
    }
    if (f.stale && d.last_touch_at && now - +new Date(d.last_touch_at) < Number(f.stale) * D) return false;
    if (f.qual && qualification(d as unknown as Record<string, unknown>).done >= 5) return false;
    if (f.owner && String(d.owner_id ?? "none") !== f.owner) return false;
    if (f.fit && !(d.fit && f.fit.includes(d.fit.grade))) return false;
    return true;
  });
}

const distinct = (list: DealCard[], pick: (d: DealCard) => (string | null | undefined)[]) =>
  [...new Set(list.flatMap((d) => pick(d).map((x) => (x ?? "").trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b));

export function FilterBar({ deals, f, onChange, team = [] }: { deals: DealCard[]; f: Filters; onChange: (f: Filters) => void; team?: Named[] }) {
  const [open, setOpen] = useState(false);
  const active = Object.values(f).filter(Boolean).length;
  const opts = {
    source: distinct(deals, (d) => [d.source]),
    city: distinct(deals, (d) => [d.city]),
    country: distinct(deals, (d) => [d.country]),
    tag: distinct(deals, (d) => d.tags ?? []),
    service: distinct(deals, (d) => d.services ?? []),
  };
  const sel = (k: keyof Filters, label: string, options: [string, string][]) => (
    <Select value={f[k]} onChange={(e) => onChange({ ...f, [k]: e.target.value })} aria-label={label} className="h-9 w-full text-xs">
      <option value="">{label}: any</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
  return (
    <>
      <Button size="sm" variant={active ? "primary" : "outline"} onClick={() => setOpen(true)}><Filter className="h-3.5 w-3.5" /> Filters{active ? ` (${active})` : ""}</Button>
      {active ? <Button size="sm" variant="ghost" onClick={() => onChange(NO_FILTERS)}><X className="h-3.5 w-3.5" /> Clear</Button> : null}
      <Sheet open={open} onOpenChange={setOpen} title="Filter deals" description="Applies to the board and the list.">
        <div className="grid gap-2 sm:grid-cols-2">
          {sel("source", "Source", opts.source.map((x) => [x, x]))}
          {sel("deal_type", "Type", DEAL_TYPES)}
          {sel("city", "City", opts.city.map((x) => [x, x]))}
          {sel("country", "Country", opts.country.map((x) => [x, x]))}
          {sel("tag", "Tag", opts.tag.map((x) => [x, x]))}
          {sel("service", "Service", opts.service.map((x) => [x, x]))}
          {sel("close", "Expected close", [["this_month", "This month"], ["overdue", "Date passed"], ["none", "No date set"]])}
          {sel("stale", "Untouched", [["7", "7+ days"], ["14", "14+ days"], ["30", "30+ days"]])}
          {sel("qual", "Qualification", [["low", "Under 5 of 12 answered"]])}
          {sel("fit", "Fit", [["A", "A only"], ["AB", "A or B"], ["CD", "C or D"]])}
          {team.length ? sel("owner", "Owner", [...team.map((t) => [String(t.id), t.name] as [string, string]), ["none", "Nobody yet"]]) : null}
        </div>
        <div className="mt-3 flex justify-between">
          <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>Clear all</Button>
          <Button variant="primary" size="sm" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </Sheet>
    </>
  );
}
