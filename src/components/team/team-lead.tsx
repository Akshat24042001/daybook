"use client";

import { ArrowDownLeft, ArrowUpRight, Check, ImagePlus, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { VoiceButton } from "@/components/voice-button";
import { cn } from "@/lib/cn";
import { teamCall } from "./kit";
import { fmtDay, fmtWhen } from "@/lib/team/format";

type Row = Record<string, unknown>;
export interface LeadViewData {
  deal: Row;
  access: { show_value: boolean; show_research: boolean; mine: boolean };
  person: Row | null;
  company: Row | null;
  timeline: Row[];
  promises: Row[];
  shots: { capture_id: number; index: number; at: string; summary: string | null }[];
  docs: Row[];
  history: Row[];
  stages: { id: number; name: string; category: string; role: string | null }[];
  research: { company: Record<string, { v: unknown }> | null; person: Record<string, { v: unknown }> | null } | null;
}

const FIELDS: [string, string, "text" | "long" | "date" | "list"][] = [
  ["next_action", "Next step", "text"], ["next_action_at", "Next step by", "date"], ["expected_close", "Expected close", "date"],
  ["requirements", "What they need", "long"], ["budget", "Budget", "text"], ["timeline", "Timeline", "text"], ["pain", "Problem today", "long"],
  ["desired_outcome", "What they want to achieve", "long"], ["compelling_event", "Why now", "text"], ["decision_process", "How they decide", "long"],
  ["competitors", "Competitors", "list"], ["risks", "Risks", "long"], ["scope", "Scope", "long"], ["payment_terms", "Payment terms", "text"],
  ["services", "Services", "list"], ["city", "City", "text"], ["country", "Country", "text"], ["industry", "Industry", "text"], ["source_detail", "Source", "text"],
];
const show = (v: unknown, kind: string) => (v === null || v === undefined || v === "" ? "" : kind === "date" ? fmtDay(v) : Array.isArray(v) ? v.join(", ") : String(v));

/** A data URL for a screenshot, shrunk before it goes to the AI. */
async function toDataUrl(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-[15px] font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

export function TeamLead({ v, voice }: { v: LeadViewData; voice: boolean }) {
  const d = v.deal;
  const id = Number(d.id);
  const router = useRouter();
  const { toast } = useToast();
  const [busy, start] = useTransition();
  const call = (body: Row, ok?: string) =>
    start(async () => {
      const r = await teamCall({ deal_id: id, ...body });
      if (!r.ok) return toast(r.error, "error");
      if (ok) toast(ok);
      router.refresh();
    });

  // details
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Row>({});
  const startEdit = () => {
    setForm(Object.fromEntries(FIELDS.map(([k, , kind]) => [k, kind === "list" ? ((d[k] as string[] | null) ?? []).join(", ") : kind === "date" ? String(d[k] ?? "").slice(0, 10) : d[k] ?? ""])));
    setEditing(true);
  };
  const saveDetails = () => {
    const patch: Row = {};
    for (const [k, , kind] of FIELDS) {
      const now = form[k];
      const was = kind === "list" ? ((d[k] as string[] | null) ?? []).join(", ") : kind === "date" ? String(d[k] ?? "").slice(0, 10) : d[k] ?? "";
      if (String(now ?? "") !== String(was ?? "")) patch[k] = kind === "list" ? String(now).split(",").map((x) => x.trim()).filter(Boolean) : now === "" ? null : now;
    }
    if (v.access.show_value && form.value_amount !== undefined && String(form.value_amount) !== String(d.value_amount ?? "")) patch.value_amount = form.value_amount === "" ? null : form.value_amount;
    if (!Object.keys(patch).length) return setEditing(false);
    start(async () => {
      const r = await teamCall({ op: "update_lead", deal_id: id, patch });
      if (!r.ok) return toast(r.error, "error");
      toast("Saved");
      setEditing(false);
      router.refresh();
    });
  };

  // stage
  const [moveTo, setMoveTo] = useState<{ id: number; name: string; category: string } | null>(null);
  const [reason, setReason] = useState("");
  const [revisit, setRevisit] = useState("");

  // log something
  const [type, setType] = useState("call");
  const [note, setNote] = useState("");
  const [paste, setPaste] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [capturing, setCapturing] = useState(false);
  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, 4 - images.length);
    const urls = await Promise.all(list.map(toDataUrl));
    setImages((c) => [...c, ...urls].slice(0, 4));
  };
  const capture = async () => {
    setCapturing(true);
    const r = await teamCall<{ result: { logged: number; promises: number; filled: string[]; already: number; summary: string } }>({ op: "capture", deal_id: id, text: paste, images });
    setCapturing(false);
    if (!r.ok) return toast(r.error, "error");
    const x = r.result;
    toast(x.already && !x.logged ? "Already logged before" : `Logged${x.logged ? ` ${x.logged} message${x.logged > 1 ? "s" : ""}` : ""}${x.promises ? `, ${x.promises} promise${x.promises > 1 ? "s" : ""}` : ""}${x.filled.length ? `, filled ${x.filled.length} field${x.filled.length > 1 ? "s" : ""}` : ""}`);
    setPaste("");
    setImages([]);
    router.refresh();
  };

  // promises
  const [pText, setPText] = useState("");
  const [pOwner, setPOwner] = useState("me");
  const [pDue, setPDue] = useState("");

  // contact
  const [contactEdit, setContactEdit] = useState(false);
  const [contact, setContact] = useState<Row>({});

  const others = v.stages.filter((s) => s.id !== Number(d.stage_id));
  const mic = (set: (t: string) => void) => <VoiceButton enabled={voice} endpoint="/api/team/voice" label="Speak into this field" onText={set} className="shrink-0" />;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-xs text-subtle">{String(d.stage_name)} · since {fmtDay(d.stage_changed_at)}{v.access.mine ? " · added by you" : ""}</p>
        <h1 className="font-display text-2xl leading-tight">{String(d.title)}</h1>
        {v.access.show_value ? <p className="text-sm">{d.value_amount ? `Value: ${Number(d.value_amount).toLocaleString("en-IN")} ${String(d.currency ?? "")}` : "No value set"}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Move stage">
          <span className="text-xs text-subtle">Move to:</span>
          {others.map((s) => (
            <button key={s.id} type="button" disabled={busy} onClick={() => (s.category === "open" && s.role !== "nurture" ? call({ op: "move_stage", stage_id: s.id }, `Moved to ${s.name}`) : (setMoveTo(s), setReason(""), setRevisit("")))}
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-accent hover:text-accent">{s.name}</button>
          ))}
        </div>
        {moveTo ? (
          <div className="mt-3 space-y-2 rounded-xl border border-border p-3" aria-label="Move details">
            <p className="text-sm font-medium">Move to {moveTo.name}</p>
            <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (needed when closing)" /></Field>
            <Field label="Come back on (optional)"><Input type="date" value={revisit} onChange={(e) => setRevisit(e.target.value)} /></Field>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => { call({ op: "move_stage", stage_id: moveTo.id, reason: reason || null, date: revisit || null }, `Moved to ${moveTo.name}`); setMoveTo(null); }}>Move</Button>
              <Button size="sm" variant="ghost" onClick={() => setMoveTo(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Section title="Log what happened">
            <div className="space-y-2">
              <div className="flex flex-wrap items-start gap-2">
                <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className="h-9 w-36 text-sm">
                  {[["call", "Call"], ["meeting", "Meeting"], ["whatsapp", "WhatsApp"], ["email", "Email"], ["in_person", "In person"], ["linkedin", "LinkedIn"], ["note", "Note"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened, what they said, what is next" aria-label="What happened" className="min-h-[70px] min-w-[220px] flex-1" />
                {mic((t) => setNote((c) => (c ? `${c} ${t}` : t)))}
              </div>
              <div className="flex justify-end"><Button size="sm" variant="primary" disabled={busy || !note.trim()} onClick={() => { call({ op: "log", type, body: note }, "Logged"); setNote(""); }}>Log it</Button></div>
            </div>
            <div className="mt-3 border-t border-border pt-3" onPaste={(e) => e.clipboardData.files.length && void addFiles(e.clipboardData.files)}>
              <p className="mb-1.5 text-[13px] font-medium">Or paste a chat or screenshot, AI files it</p>
              <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste a WhatsApp chat or email, or paste a screenshot" aria-label="Paste a chat" className="min-h-[60px]" />
              {images.length ? <div className="mt-2 flex gap-2">{images.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-14 w-14 rounded-md border border-border object-cover" />
                  <button type="button" aria-label="Remove" onClick={() => setImages((c) => c.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-fg p-0.5 text-bg"><X className="h-3 w-3" /></button>
                </div>
              ))}</div> : null}
              <div className="mt-2 flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1 text-sm text-subtle hover:text-fg"><ImagePlus className="h-4 w-4" /> Screenshot
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
                </label>
                <Button size="sm" variant="outline" className="ml-auto" disabled={capturing || (!paste.trim() && !images.length)} onClick={() => void capture()}>
                  {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {capturing ? "Reading…" : "File it"}
                </Button>
              </div>
            </div>
          </Section>

          <Section title={`Timeline · ${v.timeline.length}`}>
            {v.timeline.length ? (
              <ol className="space-y-2">
                {v.timeline.map((i) => {
                  const Dir = i.direction === "in" ? ArrowDownLeft : ArrowUpRight;
                  return (
                    <li key={String(i.id)} className="rounded-xl border border-border p-2.5">
                      <p className="flex flex-wrap items-center gap-1 text-xs text-subtle"><Dir className="h-3 w-3" /> {String(i.channel)} · {fmtWhen(i.occurred_at)} · {i.by_me ? "you" : "shared with you"}
                        {i.by_me ? <button type="button" aria-label="Delete entry" className="ml-auto text-subtle/60 hover:text-bad" onClick={() => confirm("Delete this entry?") && call({ op: "delete_log", id: i.id }, "Deleted")}><Trash2 className="h-3.5 w-3.5" /></button> : null}
                      </p>
                      <p className="whitespace-pre-wrap text-sm">{String(i.summary || i.body || i.subject || "")}</p>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="text-sm text-subtle">Nothing logged yet.</p>}
          </Section>

          {v.shots.length ? (
            <Section title={`Screenshots · ${v.shots.length}`}>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {v.shots.map((s) => (
                  <li key={`${s.capture_id}-${s.index}`}>
                    <a href={`/api/team/shot/${s.capture_id}/${s.index}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/team/shot/${s.capture_id}/${s.index}`} alt={s.summary ?? "Screenshot"} loading="lazy" className="aspect-square w-full rounded-lg border border-border object-cover" />
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <div className="space-y-4">
          <Section title="Details" action={editing ? null : <Button size="sm" variant="ghost" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}>
            {editing ? (
              <div className="space-y-2.5">
                {v.access.show_value ? <Field label="Value"><Input value={String(form.value_amount ?? d.value_amount ?? "")} onChange={(e) => setForm((f) => ({ ...f, value_amount: e.target.value }))} inputMode="decimal" /></Field> : null}
                {FIELDS.map(([k, label, kind]) => (
                  <Field key={k} label={label}>
                    {kind === "long" ? (
                      <div className="flex items-start gap-1.5"><Textarea value={String(form[k] ?? "")} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className="min-h-[60px]" />{mic((t) => setForm((f) => ({ ...f, [k]: f[k] ? `${f[k]}\n${t}` : t })))}</div>
                    ) : kind === "date" ? (
                      <Input type="date" value={String(form[k] ?? "")} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                    ) : (
                      <div className="flex items-center gap-1.5"><Input value={String(form[k] ?? "")} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />{kind === "text" ? mic((t) => setForm((f) => ({ ...f, [k]: f[k] ? `${f[k]} ${t}` : t }))) : null}</div>
                    )}
                  </Field>
                ))}
                <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" variant="primary" disabled={busy} onClick={saveDetails}>Save</Button></div>
              </div>
            ) : (
              <dl className="grid gap-x-3 gap-y-1.5 text-sm">
                {FIELDS.filter(([k, , kind]) => show(d[k], kind)).map(([k, label, kind]) => (
                  <div key={k}><dt className="text-xs text-subtle">{label}</dt><dd className="whitespace-pre-wrap">{show(d[k], kind)}</dd></div>
                ))}
                {!FIELDS.some(([k, , kind]) => show(d[k], kind)) ? <p className="text-subtle">Nothing filled in yet. Tap Edit.</p> : null}
              </dl>
            )}
          </Section>

          <Section title="Contact" action={contactEdit ? null : <Button size="sm" variant="ghost" onClick={() => { setContact({ ...(v.person ?? {}), emails: ((v.person?.emails as string[]) ?? []).join(", "), phones: ((v.person?.phones as string[]) ?? []).join(", "), ...Object.fromEntries(Object.entries(v.company ?? {}).map(([k, x]) => [`company.${k}`, x])) }); setContactEdit(true); }}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}>
            {contactEdit ? (
              <div className="space-y-2.5">
                {v.person ? ([["full_name", "Name"], ["title", "Role"], ["phones", "Phones (comma separated)"], ["emails", "Emails (comma separated)"], ["whatsapp", "WhatsApp"], ["linkedin", "LinkedIn"], ["city", "City"]] as const).map(([k, l]) => (
                  <Field key={k} label={l}><Input value={String(contact[k] ?? "")} onChange={(e) => setContact((c) => ({ ...c, [k]: e.target.value }))} /></Field>
                )) : null}
                {v.company ? ([["company.name", "Company"], ["company.website", "Website"], ["company.phone", "Company phone"], ["company.address", "Address"]] as const).map(([k, l]) => (
                  <Field key={k} label={l}><Input value={String(contact[k] ?? "")} onChange={(e) => setContact((c) => ({ ...c, [k]: e.target.value }))} /></Field>
                )) : null}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setContactEdit(false)}>Cancel</Button>
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => {
                    const patch: Row = {};
                    for (const [k, x] of Object.entries(contact)) {
                      if (k === "id" || k === "company.id") continue;
                      const was = k.startsWith("company.") ? (v.company ?? {})[k.slice(8)] : k === "emails" || k === "phones" ? ((v.person?.[k] as string[]) ?? []).join(", ") : (v.person ?? {})[k];
                      if (String(x ?? "") !== String(was ?? "")) patch[k] = x;
                    }
                    if (Object.keys(patch).length) call({ op: "update_contact", patch }, "Saved");
                    setContactEdit(false);
                  }}>Save</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                {v.person ? <p className="font-medium">{String(v.person.full_name)}{v.person.title ? <span className="font-normal text-subtle">, {String(v.person.title)}</span> : null}</p> : <p className="text-subtle">No contact.</p>}
                {[(v.person?.phones as string[] | undefined)?.join(", "), (v.person?.emails as string[] | undefined)?.join(", "), v.person?.whatsapp ? `WhatsApp ${v.person.whatsapp}` : null, v.person?.linkedin].filter(Boolean).map((x) => <p key={String(x)} className="break-all text-subtle">{String(x)}</p>)}
                {v.company ? <p className="pt-1"><span className="font-medium">{String(v.company.name)}</span>{v.company.website ? <a href={String(v.company.website)} target="_blank" rel="noreferrer" className="ml-1.5 text-accent">website</a> : null}</p> : null}
              </div>
            )}
          </Section>

          <Section title="Promises">
            <ul className="space-y-1.5 text-sm">
              {v.promises.map((p) => (
                <li key={String(p.id)} className={cn("flex items-start gap-2", p.status === "done" && "text-subtle line-through")}>
                  <button type="button" aria-label={p.status === "done" ? "Reopen" : "Done"} onClick={() => call({ op: "set_promise", id: p.id, status: p.status === "done" ? "open" : "done" })} className="mt-0.5 rounded border border-border p-0.5 hover:border-good hover:text-good"><Check className="h-3 w-3" /></button>
                  <span>{p.owner === "me" ? "I will" : "They will"}: {String(p.text)}{p.due_at ? <span className="text-xs text-subtle"> · {fmtDay(p.due_at)}</span> : null}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Select value={pOwner} onChange={(e) => setPOwner(e.target.value)} aria-label="Who" className="h-8 w-28 text-xs"><option value="me">I will</option><option value="them">They will</option></Select>
              <Input value={pText} onChange={(e) => setPText(e.target.value)} placeholder="Send the proposal" aria-label="Promise" className="h-8 min-w-0 flex-1 text-sm" />
              <Input type="date" value={pDue} onChange={(e) => setPDue(e.target.value)} aria-label="By" className="h-8 w-36 text-xs" />
              <Button size="sm" variant="outline" disabled={busy || !pText.trim()} onClick={() => { call({ op: "add_promise", owner: pOwner, text: pText, due: pDue || null }, "Added"); setPText(""); setPDue(""); }}>Add</Button>
            </div>
          </Section>

          {v.docs.length ? (
            <Section title="Documents">
              <ul className="space-y-1 text-sm">{v.docs.map((x) => <li key={String(x.id)}><a href={`/q/${x.slug}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">{String(x.title)}</a> <span className="text-xs text-subtle">{String(x.kind)}</span></li>)}</ul>
            </Section>
          ) : null}

          {v.research ? (
            <Section title="Research">
              {[["Company", v.research.company], ["Person", v.research.person]].map(([label, data]) => {
                const rows = Object.entries((data ?? {}) as Record<string, { v: unknown }>).filter(([, f]) => f?.v !== null && f?.v !== undefined && f?.v !== "");
                return rows.length ? (
                  <div key={String(label)} className="mb-3">
                    <p className="mb-1 text-[13px] font-medium">{String(label)}</p>
                    <dl className="space-y-1 text-[13px]">{rows.slice(0, 30).map(([k, f]) => <div key={k}><dt className="text-xs text-subtle">{k.replace(/_/g, " ")}</dt><dd className="whitespace-pre-wrap break-words">{String(f.v)}</dd></div>)}</dl>
                  </div>
                ) : null;
              })}
              {!Object.keys(v.research.company ?? {}).length && !Object.keys(v.research.person ?? {}).length ? <p className="text-sm text-subtle">Research is running or found nothing yet. Check back in a few minutes.</p> : null}
            </Section>
          ) : null}

          <Section title="History">
            <ul className="space-y-1 text-xs text-subtle">
              {v.history.slice(0, 40).map((h, i) => (
                <li key={i}>{fmtDay(h.created_at)} · {h.kind === "stage" ? `${h.from_name ?? "?"} → ${h.to_name}` : h.kind === "created" ? "Lead added" : `${String(h.field).replace(/_/g, " ")}: ${h.old_value ?? "empty"} → ${h.new_value ?? "empty"}`}</li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
