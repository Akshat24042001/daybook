"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { importContactsAction, mergePeopleAction, updateCompanyAction, updatePersonAction } from "@/app/sales-actions";
import { Button, Chip, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { Enrichment } from "@/lib/sales/enrich";
import { EnrichmentPanel } from "./enrichment-panel";
import { ago, money } from "./util";
import { Ago } from "@/components/sales/ago";

export interface CompanyRow { id: number; name: string; website: string | null; industry: string | null; country: string | null; employees: number | null; revenue_usd: number | null; revenue_is_estimate: boolean; listed: boolean | null; enrichment: Enrichment; enriched_at: string | null; notes: string | null; deals: { id: number; title: string; stage: string }[] }
export interface PersonRow { id: number; full_name: string; title: string | null; company_name: string | null; emails: string[]; phones: string[]; linkedin: string | null; instagram: string | null; city: string | null; country: string | null; relationship: string; is_decision_maker: boolean | null; enrichment: Enrichment; enriched_at: string | null; notes: string | null; last_touch: string | null; deals: { id: number; title: string; stage: string }[] }

type Groups = { group: string; fields: [string, string][] }[];

export function AccountsView({ companies, people, companyFields, personFields, contacts }: { companies: CompanyRow[]; people: PersonRow[]; companyFields: Groups; personFields: Groups; contacts: { id: number; name: string; company: string | null }[] }) {
  const [tab, setTab] = useState<"people" | "companies">("people");
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState<PersonRow | null>(null);
  const [company, setCompany] = useState<CompanyRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const qy = query.trim().toLowerCase();
  const ppl = useMemo(() => people.filter((p) => !qy || [p.full_name, p.company_name, p.title, ...p.emails, ...p.phones].some((x) => x?.toLowerCase().includes(qy))), [people, qy]);
  const cos = useMemo(() => companies.filter((c) => !qy || [c.name, c.industry, c.country, c.website].some((x) => x?.toLowerCase().includes(qy))), [companies, qy]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl leading-tight">Accounts</h1>
          <p className="text-sm text-subtle">Companies and people you sell to.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>Import from Contacts</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["people", "companies"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-md border px-3 py-1 text-xs capitalize", tab === k ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle")}>
            {k} · {k === "people" ? people.length : companies.length}
          </button>
        ))}
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-9 max-w-xs text-sm" />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        {tab === "people" ? (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted text-left text-xs text-subtle"><tr><th className="p-2">Name</th><th className="p-2">Company</th><th className="p-2">Contact</th><th className="p-2">Relationship</th><th className="p-2">Deals</th><th className="p-2">Last touch</th></tr></thead>
            <tbody>
              {ppl.map((p) => (
                <tr key={p.id} className="cursor-pointer border-t border-border hover:bg-muted/50" onClick={() => setPerson(p)}>
                  <td className="p-2"><p className="font-medium">{p.full_name}{p.is_decision_maker ? <span className="ml-1 text-[10px] text-good">decides</span> : null}</p><p className="text-xs text-subtle">{p.title}</p></td>
                  <td className="p-2 text-xs">{p.company_name}</td>
                  <td className="p-2 text-xs text-subtle">{[p.phones[0], p.emails[0]].filter(Boolean).join(" · ")}</td>
                  <td className="p-2"><Chip>{p.relationship}</Chip></td>
                  <td className="p-2 text-xs">{p.deals.map((d) => d.stage).join(", ")}</td>
                  <td className="p-2 text-xs text-subtle">{p.last_touch ? <Ago d={p.last_touch} /> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted text-left text-xs text-subtle"><tr><th className="p-2">Company</th><th className="p-2">Industry</th><th className="p-2">Country</th><th className="p-2 text-right">People</th><th className="p-2 text-right">Revenue / yr</th><th className="p-2">Deals</th></tr></thead>
            <tbody>
              {cos.map((c) => (
                <tr key={c.id} className="cursor-pointer border-t border-border hover:bg-muted/50" onClick={() => setCompany(c)}>
                  <td className="p-2"><p className="font-medium">{c.name}{c.listed ? <span className="ml-1 text-[10px] text-accent">listed</span> : null}</p><p className="text-xs text-subtle">{c.website?.replace(/^https?:\/\/(www\.)?/, "")}</p></td>
                  <td className="p-2 text-xs">{c.industry}</td>
                  <td className="p-2 text-xs">{c.country}</td>
                  <td className="p-2 text-right text-xs tabular">{c.employees ?? ""}</td>
                  <td className="p-2 text-right text-xs tabular">{c.revenue_usd ? `${money(c.revenue_usd, "USD")}${c.revenue_is_estimate ? " est." : ""}` : ""}</td>
                  <td className="p-2 text-xs">{c.deals.map((d) => d.stage).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {person ? <PersonSheet p={person} people={people} groups={personFields} onClose={() => setPerson(null)} /> : null}
      {company ? (
        <Sheet open onOpenChange={(o) => !o && setCompany(null)} title={company.name} description={[company.industry, company.country].filter(Boolean).join(" · ")}>
          <CompanyEdit c={company} />
          <div className="mt-3 space-y-1 text-sm">{company.deals.map((d) => <Link key={d.id} href={`/sales/deal/${d.id}`} className="block text-accent hover:underline">{d.title} · {d.stage}</Link>)}</div>
          <div className="mt-3"><EnrichmentPanel kind="company" id={company.id} data={company.enrichment} groups={companyFields} enrichedAt={company.enriched_at} title="Research" /></div>
        </Sheet>
      ) : null}
      <Sheet open={importOpen} onOpenChange={setImportOpen} title="Import from Contacts" description="Your warm network: pick who could buy or refer.">
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {contacts.map((c) => (
            <li key={c.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />{c.name}<span className="text-xs text-subtle">{c.company}</span></label></li>
          ))}
          {!contacts.length ? <li className="text-sm text-subtle">Everyone in Contacts is already here.</li> : null}
        </ul>
        <div className="mt-3 flex justify-end"><Button variant="primary" disabled={!picked.size || busy} onClick={() => start(async () => {
          const r = await importContactsAction([...picked]);
          if (!r.ok) return toast(r.error, "error");
          toast(`Imported ${r.n}`);
          setImportOpen(false);
          setPicked(new Set());
          router.refresh();
        })}>Import {picked.size || ""}</Button></div>
      </Sheet>
    </div>
  );
}

function CompanyEdit({ c }: { c: CompanyRow }) {
  const [f, setF] = useState({ name: c.name, website: c.website ?? "", industry: c.industry ?? "", country: c.country ?? "", notes: c.notes ?? "" });
  const [busy, start] = useTransition();
  const router = useRouter();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Website"><Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></Field>
      <Field label="Industry"><Input value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} /></Field>
      <Field label="Country"><Input value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-[60px]" /></Field></div>
      <div className="sm:col-span-2 flex justify-end"><Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => { await updateCompanyAction(c.id, f); router.refresh(); })}>Save</Button></div>
    </div>
  );
}

function PersonSheet({ p, people, groups, onClose }: { p: PersonRow; people: PersonRow[]; groups: Groups; onClose: () => void }) {
  const [f, setF] = useState({ full_name: p.full_name, title: p.title ?? "", emails: p.emails.join(", "), phones: p.phones.join(", "), linkedin: p.linkedin ?? "", instagram: p.instagram ?? "", relationship: p.relationship, city: p.city ?? "", country: p.country ?? "", notes: p.notes ?? "" });
  const [mergeWith, setMergeWith] = useState("");
  const [busy, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={p.full_name} description={[p.title, p.company_name].filter(Boolean).join(" · ")}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Name"><Input value={f.full_name} onChange={set("full_name")} /></Field>
        <Field label="Title"><Input value={f.title} onChange={set("title")} /></Field>
        <Field label="Emails (comma separated)"><Input value={f.emails} onChange={set("emails")} /></Field>
        <Field label="Phones / WhatsApp"><Input value={f.phones} onChange={set("phones")} /></Field>
        <Field label="LinkedIn"><Input value={f.linkedin} onChange={set("linkedin")} /></Field>
        <Field label="Instagram"><Input value={f.instagram} onChange={set("instagram")} /></Field>
        <Field label="City"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="Country"><Input value={f.country} onChange={set("country")} /></Field>
        <Field label="Relationship"><Select value={f.relationship} onChange={set("relationship")}>{["cold", "warm", "referral", "partner", "client"].map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <div className="sm:col-span-2"><Field label="Notes"><Textarea value={f.notes} onChange={set("notes")} className="min-h-[60px]" /></Field></div>
      </div>
      <div className="mt-2 flex justify-end"><Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
        const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
        const r = await updatePersonAction(p.id, { ...f, emails: split(f.emails), phones: split(f.phones) });
        if (!r.ok) return toast(r.error, "error");
        toast("Saved");
        router.refresh();
      })}>Save</Button></div>
      <div className="mt-3 space-y-1 text-sm">{p.deals.map((d) => <Link key={d.id} href={`/sales/deal/${d.id}`} className="block text-accent hover:underline">{d.title} · {d.stage}</Link>)}</div>
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-border p-2">
        <Field label="Same person as (merge)">
          <Select value={mergeWith} onChange={(e) => setMergeWith(e.target.value)} className="h-9 w-56 text-sm">
            <option value="">Pick a duplicate…</option>
            {people.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.full_name}{x.company_name ? ` · ${x.company_name}` : ""}</option>)}
          </Select>
        </Field>
        <Button size="sm" variant="outline" disabled={!mergeWith || busy} onClick={() => confirm("Merge the duplicate into this person? Its chats and deals move here.") && start(async () => {
          const r = await mergePeopleAction(p.id, Number(mergeWith));
          if (!r.ok) return toast(r.error, "error");
          toast("Merged");
          onClose();
          router.refresh();
        })}>Merge</Button>
      </div>
      <div className="mt-3"><EnrichmentPanel kind="person" id={p.id} data={p.enrichment} groups={groups} enrichedAt={p.enriched_at} title="Research" /></div>
    </Sheet>
  );
}
