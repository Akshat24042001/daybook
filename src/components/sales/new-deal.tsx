"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createDealAction } from "@/app/sales-actions";
import { Button, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { CURRENCIES, currencyLabel, currencySymbol } from "./format";
import { DEAL_TYPES } from "@/lib/sales/fields";

/** defaultCurrency: Sales settings > Default currency (INR unless you changed it). */
export function NewDealButton({ defaultCurrency = "INR" }: { defaultCurrency?: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ person_name: "", company_name: "", email: "", phone: "", linkedin: "", source: "outbound", referrer_name: "", value_amount: "", currency: defaultCurrency, notes: "", stage_role: "new", city: "", region: "", industry: "", deal_type: "new", expected_close: "", services: "" });
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((c) => ({ ...c, [k]: e.target.value }));

  const save = () =>
    start(async () => {
      const r = await createDealAction({ ...f, value_amount: f.value_amount ? Number(f.value_amount) : null });
      if (!r.ok) return toast(r.error, "error");
      setOpen(false);
      router.push(`/sales/deal/${r.id}`);
    });

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New lead
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="New lead" description="Only a name or company is needed. Enrichment fills the rest in the background.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Person"><Input value={f.person_name} onChange={set("person_name")} placeholder="Rahul Mehta" autoFocus /></Field>
          <Field label="Company"><Input value={f.company_name} onChange={set("company_name")} placeholder="Acme Jewels" /></Field>
          <Field label="WhatsApp / phone"><Input value={f.phone} onChange={set("phone")} placeholder="+971..." /></Field>
          <Field label="Email"><Input value={f.email} onChange={set("email")} type="email" /></Field>
          <Field label="LinkedIn"><Input value={f.linkedin} onChange={set("linkedin")} placeholder="linkedin.com/in/..." /></Field>
          <Field label="Source">
            <Select value={f.source} onChange={set("source")}>
              <option value="outbound">Outbound (I reached out)</option>
              <option value="inbound">Inbound (they came to me)</option>
              <option value="referral">Referral</option>
              <option value="network">My network</option>
              <option value="content">My content</option>
              <option value="partner">Partner / intermediary</option>
              <option value="radar">Radar</option>
              <option value="repeat">Repeat client</option>
            </Select>
          </Field>
          <Field label="Referred by"><Input value={f.referrer_name} onChange={set("referrer_name")} placeholder="Who sent them your way" /></Field>
          <Field label="Starts at">
            <Select value={f.stage_role} onChange={set("stage_role")}>
              <option value="new">New (not contacted)</option>
              <option value="contacted">Contacted</option>
              <option value="engaged">In conversation</option>
              <option value="discovery">Discovery</option>
            </Select>
          </Field>
          <Field label={`Value (${currencySymbol(f.currency)})`}><Input value={f.value_amount} onChange={set("value_amount")} inputMode="decimal" placeholder={`${currencySymbol(f.currency)} optional`} /></Field>
          <Field label="Currency">
            <Select value={f.currency} onChange={set("currency")}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="City"><Input value={f.city} onChange={set("city")} placeholder="Pune" /></Field>
          <Field label="State / region"><Input value={f.region} onChange={set("region")} placeholder="Maharashtra" /></Field>
          <Field label="Industry"><Input value={f.industry} onChange={set("industry")} placeholder="Clinics, logistics, retail…" /></Field>
          <Field label="Type">
            <Select value={f.deal_type} onChange={set("deal_type")} aria-label="Deal type">{DEAL_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          </Field>
          <Field label="Services" hint="Comma separated"><Input value={f.services} onChange={set("services")} placeholder="Website, WhatsApp bot" /></Field>
          <Field label="Expected close"><Input type="date" value={f.expected_close} onChange={set("expected_close")} aria-label="Expected close" /></Field>
        </div>
        <div className="mt-3">
          <Field label="What they need"><Textarea value={f.notes} onChange={set("notes")} placeholder="Requirement, context, anything" /></Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={save} disabled={pending}>{pending ? "Saving…" : "Create lead"}</Button>
        </div>
      </Sheet>
    </>
  );
}
