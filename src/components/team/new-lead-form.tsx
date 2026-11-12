"use client";

import { prepImages } from "@/lib/client/image-prep";
import { ImagePlus, Loader2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { VoiceButton } from "@/components/voice-button";
import { cn } from "@/lib/cn";
import { checkNewLead, LEAD_SOURCES, LEAD_STATUS, REFERRER_TYPES, type NewLeadInput } from "@/lib/team/new-lead";
import { teamCall } from "./kit";


function Block({ n, title, error, children }: { n: number; title: string; error?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border bg-surface p-4", error ? "border-warn/50" : "border-border")} aria-label={title}>
      <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-muted text-xs text-accent">{n}</span>{title}</h2>
      {children}
      {error ? <p className="mt-2 text-xs text-warn">{error}</p> : null}
    </section>
  );
}

/**
 * A new lead from a salesperson. Five things are required (who, a way to reach them, where it came from, why it is
 * a lead, how far it has gone); everything else only raises the quality. A screenshot or pasted chat can fill it in.
 */
export function NewLeadForm({ services, voice }: { services: string[]; voice: boolean }) {
  const [f, setF] = useState<NewLeadInput>({ source: "", status: "", services: [] });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [filling, setFilling] = useState(false);
  const { toast } = useToast();
  const chk = useMemo(() => checkNewLead(f), [f]);
  const set = (k: keyof NewLeadInput) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const err = (k: string) => (tried ? chk.errors[k] : undefined);

  const prefill = async () => {
    setFilling(true);
    const r = await teamCall<{ fields: Partial<NewLeadInput> }>({ op: "prefill", text: paste, images });
    setFilling(false);
    if (!r.ok) return toast(r.error, "error");
    const got = Object.fromEntries(Object.entries(r.fields).filter(([, v]) => v !== null && v !== undefined && v !== ""));
    setF((x) => ({ ...x, ...got, ...(got.referrer_name ? { source: "referral" } : {}) }));
    toast(`Filled ${Object.keys(got).length} field${Object.keys(got).length === 1 ? "" : "s"}. Check them, then add the rest.`);
  };

  const submit = async () => {
    setTried(true);
    if (!chk.ok) return toast(Object.values(chk.errors)[0], "error");
    setBusy(true);
    const r = await teamCall<{ id: number }>({ op: "create_lead", lead: f });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Lead added. Research has started.");
    window.location.href = `/team/lead/${r.id}`;
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="font-display text-2xl">New lead</h1>
        <p className="text-sm text-subtle">Five things are needed. The more you add, the better the lead.</p>
      </div>

      <section className="rounded-2xl border border-dashed border-border bg-surface p-4" onPaste={(e) => e.clipboardData.files.length && void prepImages(Array.from(e.clipboardData.files).filter((x) => x.type.startsWith("image/"))).then(({ urls }) => setImages((c) => [...c, ...urls].slice(0, 4)))}>
        <p className="mb-1.5 flex items-center gap-1 text-[13px] font-medium"><Sparkles className="h-3.5 w-3.5 text-accent" /> Fill from a screenshot or chat (optional)</p>
        <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste their message, email signature or profile, or paste a screenshot" aria-label="Paste to fill" className="min-h-[56px]" />
        <div className="mt-2 flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1 text-sm text-subtle hover:text-fg"><ImagePlus className="h-4 w-4" /> Screenshot{images.length ? ` (${images.length})` : ""}
            <input type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void prepImages(Array.from(e.target.files)).then(({ urls }) => setImages((c) => [...c, ...urls].slice(0, 4)))} />
          </label>
          <Button size="sm" variant="outline" className="ml-auto" disabled={filling || (!paste.trim() && !images.length)} onClick={() => void prefill()}>
            {filling ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {filling ? "Reading…" : "Fill the form"}
          </Button>
        </div>
      </section>

      <Block n={1} title="Who" error={err("who")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company"><Input value={f.company ?? ""} onChange={set("company")} placeholder="Shah Dental Clinics" /></Field>
          <Field label="Contact person"><Input value={f.person ?? ""} onChange={set("person")} placeholder="Dr Ravi Shah" /></Field>
          <Field label="Their role (optional)"><Input value={f.title ?? ""} onChange={set("title")} placeholder="Owner, Operations head…" /></Field>
          <Field label="Do they decide? (optional)">
            <Select value={f.decision_maker === undefined ? "" : f.decision_maker ? "yes" : "no"} onChange={(e) => setF((x) => ({ ...x, decision_maker: e.target.value === "" ? undefined : e.target.value === "yes" }))}>
              <option value="">Not sure</option><option value="yes">Yes, they decide</option><option value="no">No, someone else does</option>
            </Select>
          </Field>
        </div>
      </Block>

      <Block n={2} title="How to reach them (at least one)" error={err("reach")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone"><Input value={f.phone ?? ""} onChange={set("phone")} inputMode="tel" placeholder="+91 98200 11111" /></Field>
          <Field label="WhatsApp (if different)"><Input value={f.whatsapp ?? ""} onChange={set("whatsapp")} inputMode="tel" /></Field>
          <Field label="Email"><Input value={f.email ?? ""} onChange={set("email")} inputMode="email" /></Field>
          <Field label="LinkedIn profile link"><Input value={f.linkedin ?? ""} onChange={set("linkedin")} placeholder="linkedin.com/in/…" /></Field>
          <Field label="Instagram"><Input value={f.instagram ?? ""} onChange={set("instagram")} placeholder="@handle" /></Field>
          <Field label="Website"><Input value={f.website ?? ""} onChange={set("website")} placeholder="shahdental.in" /></Field>
        </div>
      </Block>

      <Block n={3} title="Where it came from" error={err("source")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Source">
            <Select value={f.source ?? ""} onChange={set("source")}>
              <option value="">Pick one</option>
              {LEAD_SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          {f.source === "referral" ? (
            <>
              <Field label="Referred by"><Input value={f.referrer_name ?? ""} onChange={set("referrer_name")} placeholder="Name of who referred them" /></Field>
              <Field label="Who they are to us">
                <Select value={f.referrer_type ?? ""} onChange={set("referrer_type")}>
                  <option value="">Pick one</option>
                  {REFERRER_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
            </>
          ) : f.source ? (
            <Field label={f.source === "event" ? "Which event" : f.source === "partner" ? "Which partner" : f.source === "existing_client" ? "Which client" : "Details (optional)"}>
              <Input value={f.source_detail ?? ""} onChange={set("source_detail")} />
            </Field>
          ) : null}
        </div>
      </Block>

      <Block n={4} title="What they need" error={err("need")}>
        <div className="flex items-start gap-1.5">
          <Textarea value={f.need ?? ""} onChange={set("need")} placeholder="They miss about 30 calls a day and want a WhatsApp booking bot for 3 branches." aria-label="What they need" className="min-h-[80px]" />
          <VoiceButton enabled={voice} endpoint="/api/team/voice" label="Speak into this field" onText={(t) => setF((x) => ({ ...x, need: x.need ? `${x.need} ${t}` : t }))} className="shrink-0" />
        </div>
        {services.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Services">
            {services.map((s) => {
              const on = (f.services ?? []).includes(s);
              return <button key={s} type="button" onClick={() => setF((x) => ({ ...x, services: on ? (x.services ?? []).filter((y) => y !== s) : [...(x.services ?? []), s] }))} className={cn("rounded-md border px-2 py-1 text-xs", on ? "border-accent bg-accent/10 text-accent" : "border-border")}>{s}</button>;
            })}
          </div>
        ) : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Budget (optional)"><Input value={f.budget ?? ""} onChange={set("budget")} placeholder="around 2 lakh" /></Field>
          <Field label="Timeline (optional)"><Input value={f.timeline ?? ""} onChange={set("timeline")} placeholder="before Diwali" /></Field>
        </div>
      </Block>

      <Block n={5} title="How far it has gone" error={err("status")}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How far it has gone">
          {LEAD_STATUS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={f.status === k} onClick={() => setF((x) => ({ ...x, status: k }))} className={cn("rounded-lg border px-3 py-1.5 text-sm", f.status === k ? "border-accent bg-accent-muted text-accent" : "border-border")}>{l}</button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="City (optional)"><Input value={f.city ?? ""} onChange={set("city")} /></Field>
          <Field label="Country (optional)"><Input value={f.country ?? ""} onChange={set("country")} placeholder="India" /></Field>
          <Field label="Industry (optional)"><Input value={f.industry ?? ""} onChange={set("industry")} /></Field>
        </div>
      </Block>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-[var(--shadow-lg)]">
        <span className="text-sm">Lead quality: <b className={cn(chk.quality === "Strong" ? "text-good" : chk.quality === "Good" ? "text-accent" : "text-subtle")}>{chk.quality}</b></span>
        {chk.missing.length && chk.quality !== "Strong" ? <span className="text-xs text-subtle">Add {chk.missing.slice(0, 3).join(", ")} to make it stronger.</span> : null}
        <Button variant="primary" className="ml-auto" disabled={busy} onClick={() => void submit()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add lead</Button>
      </div>
    </div>
  );
}
