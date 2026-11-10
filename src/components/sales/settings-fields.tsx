"use client";

import { Eye, EyeOff, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveConfigAction, saveCustomFieldAction, setCustomFieldActiveAction } from "@/app/sales-actions";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { CustomField, CustomType } from "@/lib/sales/custom-fields";
import { DEFAULT_REASONS, type Reasons } from "@/lib/sales/fields";

const TYPES: [CustomType, string][] = [
  ["text", "Short text"], ["long_text", "Long text"], ["number", "Number"], ["money", "Amount"], ["date", "Date"],
  ["select", "Pick one"], ["multi_select", "Pick several"], ["checkbox", "Yes / no"], ["url", "Link"], ["phone", "Phone"], ["email", "Email"],
];
const SCOPES: [string, string][] = [["deal", "Deals"], ["company", "Companies"], ["person", "People"]];

function FieldForm({ f, onDone }: { f: Partial<CustomField>; onDone: () => void }) {
  const [v, setV] = useState({
    label: f.label ?? "", type: (f.type ?? "text") as CustomType, scope: f.scope ?? "deal", options: (f.options ?? []).join("\n"), help: f.help ?? "", required_to_win: !!f.required_to_win,
  });
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const choices = v.type === "select" || v.type === "multi_select";
  return (
    <div className="space-y-3 rounded-xl border border-accent/40 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><Input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="GST number" aria-label="Field name" autoFocus /></Field>
        <Field label="Type"><Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as CustomType })} aria-label="Field type">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {f.id ? <span /> : <Field label="On"><Select value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value as CustomField["scope"] })} aria-label="Field on">{SCOPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>}
      </div>
      {choices ? <Field label="Choices" hint="One per line"><Textarea value={v.options} onChange={(e) => setV({ ...v, options: e.target.value })} className="min-h-[80px]" aria-label="Choices" /></Field> : null}
      <Field label="Hint (optional)" hint="Shown under the field"><Input value={v.help} onChange={(e) => setV({ ...v, help: e.target.value })} /></Field>
      {v.scope === "deal" ? (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.required_to_win} onChange={(e) => setV({ ...v, required_to_win: e.target.checked })} /> Needed to close a deal as won (asked in the Won checklist)</label>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => start(async () => {
          const r = await saveCustomFieldAction({ id: f.id, scope: v.scope as CustomField["scope"], label: v.label, type: v.type, options: v.options, help: v.help, required_to_win: v.required_to_win });
          if (!r.ok) return toast(r.error, "error");
          toast("Saved");
          onDone();
          router.refresh();
        })}>Save</Button>
      </div>
    </div>
  );
}

/** Your own fields on deals, companies and people. */
export function CustomFieldsCard({ fields }: { fields: CustomField[] }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <div className="space-y-2">
      {SCOPES.map(([scope, label]) => {
        const list = fields.filter((x) => x.scope === scope);
        if (!list.length) return null;
        return (
          <div key={scope}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">{label}</p>
            <ul className="space-y-1.5">
              {list.map((x) => editing === x.id ? <li key={x.id}><FieldForm f={x} onDone={() => setEditing(null)} /></li> : (
                <li key={x.id} className={cn("flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm", !x.active && "opacity-50")}>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{x.label}</span>
                    <span className="ml-2 text-xs text-subtle">{TYPES.find(([k]) => k === x.type)?.[1]}{x.options.length ? `: ${x.options.slice(0, 4).join(", ")}${x.options.length > 4 ? "…" : ""}` : ""}{x.required_to_win ? " · needed to win" : ""}{x.active ? "" : " · hidden"}</span>
                  </span>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${x.label}`} onClick={() => setEditing(x.id)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={x.active ? `Hide ${x.label}` : `Show ${x.label}`} disabled={busy} onClick={() => start(async () => {
                    const r = await setCustomFieldActiveAction(x.id, !x.active);
                    if (!r.ok) return toast(r.error, "error");
                    router.refresh();
                  })}>{x.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {!fields.length ? <p className="text-[13px] text-subtle">None yet. Add any field you need, for example GST number, Decision date, Number of branches, or Preferred language.</p> : null}
      {editing === "new" ? <FieldForm f={{}} onDone={() => setEditing(null)} /> : <Button variant="outline" size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add a field</Button>}
      <p className="text-xs text-subtle">Hiding a field keeps what you saved in it; showing it again brings the values back.</p>
    </div>
  );
}

const REASON_KINDS: [keyof Reasons, string, string][] = [
  ["lost", "Lost", "Asked when a deal is lost"],
  ["disqualified", "Disqualified", "Asked when a lead is not a real deal"],
  ["won", "Won", "Why they chose you, asked in the Won checklist"],
  ["parked", "Parked", "Nurture, On hold, Ghosted"],
  ["reopened", "Reopened", "A lost, parked or won deal back to an open stage"],
];

/** The choices offered when a deal closes, parks or reopens. Insights groups wins and losses by them. */
export function ReasonsCard({ reasons }: { reasons: Reasons }) {
  const [v, setV] = useState(() => Object.fromEntries(REASON_KINDS.map(([k]) => [k, reasons[k].join("\n")])) as Record<keyof Reasons, string>);
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {REASON_KINDS.map(([k, label, hint]) => (
          <Field key={k} label={label} hint={`${hint}. One per line.`}>
            <Textarea value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="min-h-[150px] text-xs" aria-label={`${label} reasons`} />
          </Field>
        ))}
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setV(Object.fromEntries(REASON_KINDS.map(([k]) => [k, DEFAULT_REASONS[k].join("\n")])) as Record<keyof Reasons, string>)}>Restore the defaults</Button>
        <Button variant="primary" disabled={busy} onClick={() => start(async () => {
          const next = Object.fromEntries(REASON_KINDS.map(([k]) => [k, [...new Set(v[k].split("\n").map((x) => x.trim()).filter(Boolean))].slice(0, 40)])) as unknown as Reasons;
          const empty = REASON_KINDS.find(([k]) => !next[k].length);
          if (empty) return toast(`${empty[1]} needs at least one reason.`, "error");
          const r = await saveConfigAction({ reasons: next });
          if (!r.ok) return toast(r.error, "error");
          toast("Saved");
          router.refresh();
        })}>Save</Button>
      </div>
      <p className="text-xs text-subtle">Renaming a reason does not change deals already closed with the old wording.</p>
    </div>
  );
}
