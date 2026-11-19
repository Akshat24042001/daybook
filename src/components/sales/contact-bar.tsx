"use client";
import { Building2, Copy, Globe, Instagram, Linkedin, Mail, MapPin, MessageCircle, Phone, Plus } from "lucide-react";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";

export interface ContactPerson {
  name: string;
  role?: string | null;
  phones?: string[] | null;
  whatsapp?: string | null;
  emails?: string[] | null;
  linkedin?: string | null;
  instagram?: string | null;
  location?: string | null;
}
export interface ContactCompany { name: string; website?: string | null; phone?: string | null; email?: string | null; location?: string | null }

const digits = (s: string) => s.replace(/\D/g, "");
const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const handle = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");

/** True when there is at least one way to reach someone. Pure. */
export function hasContact(people: ContactPerson[], company?: ContactCompany | null): boolean {
  return people.some((p) => (p.phones?.length ?? 0) + (p.emails?.length ?? 0) > 0 || !!p.whatsapp || !!p.linkedin || !!p.instagram)
    || !!(company?.phone || company?.email || company?.website);
}

/**
 * How to reach them, on top of every lead: each person's numbers (call and WhatsApp), emails, LinkedIn, Instagram and
 * where they are, then the business's own line, inbox and website. One tap to call, write or open; one tap to copy.
 * With a message ready, WhatsApp and email open with it filled in.
 */
export function ContactBar({ people, company, message, subject, onAdd, proof = {} }: { people: ContactPerson[]; company?: ContactCompany | null; message?: string | null; subject?: string | null; onAdd?: () => void;
  /** where each found phone or email was seen (by phone digits or lowercase email): shown as "source" so you can check it */
  proof?: Record<string, string> }) {
  const proofOf = (v: string) => proof[/@/.test(v) ? v.toLowerCase() : digits(v).slice(-9)] ?? null;
  const Src = ({ v }: { v: string }) => {
    const u = proofOf(v);
    return u && /^https?:/.test(u) ? <a href={u} target="_blank" rel="noreferrer" className="text-[11px] text-subtle underline hover:text-accent" title={`Seen on ${u}`}>source</a> : null;
  };
  const { toast } = useToast();
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast(`Copied ${t}`), () => toast("Your browser blocked copying.", "error"));
  const shown = people.slice(0, 3);
  const any = hasContact(shown, company);
  const body = message ? `&body=${encodeURIComponent(message)}` : "";
  const subj = subject ? `subject=${encodeURIComponent(subject)}` : "";
  const mail = (e: string) => `mailto:${e}${subj || body ? `?${[subj, body.slice(1)].filter(Boolean).join("&")}` : ""}`;
  const wa = (n: string) => `https://wa.me/${digits(n)}${message ? `?text=${encodeURIComponent(message)}` : ""}`;

  return (
    <div className={cn("mt-3 rounded-xl border px-3 py-2.5", any ? "border-good/30 bg-p-mint/25" : "border-warn/40 bg-p-butter/40")} aria-label="Contact details">
      <p className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-subtle">
        Contact
        {onAdd ? <button type="button" onClick={onAdd} className="inline-flex items-center gap-0.5 font-medium normal-case text-accent hover:underline"><Plus className="h-3 w-3" /> Add details</button> : null}
      </p>
      {!any ? <p className="text-sm">No phone, email or profile yet.{onAdd ? " Add what you have, or research finds it." : ""}</p> : null}
      <ul className="space-y-1.5">
        {shown.map((p) => {
          const phones = [...new Set([...(p.phones ?? []).filter((x) => digits(x).length >= 7), ...(p.whatsapp && !(p.phones ?? []).some((x) => digits(x) === digits(p.whatsapp!)) ? [p.whatsapp] : [])])];
          const emails = (p.emails ?? []).filter((e) => /@/.test(e));
          const has = phones.length || emails.length || p.linkedin || p.instagram || p.location;
          if (!has && shown.length > 1) return null;
          return (
            <li key={p.name} className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="mr-1 font-semibold">{p.name}{p.role ? <span className="ml-1 text-xs font-normal text-subtle">{p.role}</span> : null}</span>
              {phones.map((n) => (
                <span key={n} className="inline-flex items-center gap-1">
                  <a href={`tel:${n.replace(/[^\d+]/g, "")}`} className="act act-primary" title="Call"><Phone className="h-3.5 w-3.5" /> {n}</a>
                  <a href={wa(n)} target="_blank" rel="noreferrer" className="act" title={message || "WhatsApp"}><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>
                  <CopyBtn onClick={() => copy(n)} label={`Copy ${n}`} /><Src v={n} />
                </span>
              ))}
              {emails.map((e) => (
                <span key={e} className="inline-flex items-center gap-1">
                  <a href={mail(e)} className="act act-primary" title={message || "Email"}><Mail className="h-3.5 w-3.5" /> {e}</a>
                  <CopyBtn onClick={() => copy(e)} label={`Copy ${e}`} /><Src v={e} />
                </span>
              ))}
              {p.linkedin ? <a href={href(p.linkedin)} target="_blank" rel="noreferrer" className="act"><Linkedin className="h-3.5 w-3.5" /> LinkedIn</a> : null}
              {p.instagram ? <a href={`https://instagram.com/${p.instagram.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "")}`} target="_blank" rel="noreferrer" className="act"><Instagram className="h-3.5 w-3.5" /> Instagram</a> : null}
              {p.location ? <span className="inline-flex items-center gap-0.5 text-xs text-subtle"><MapPin className="h-3.5 w-3.5" />{p.location}</span> : null}
            </li>
          );
        })}
        {company && (company.phone || company.email || company.website || company.location) ? (
          <li className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="mr-1 inline-flex items-center gap-1 font-semibold"><Building2 className="h-3.5 w-3.5 text-subtle" />{company.name}<span className="text-xs font-normal text-subtle">office</span></span>
            {company.phone ? <span className="inline-flex items-center gap-1"><a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`} className="act"><Phone className="h-3.5 w-3.5" /> {company.phone}</a><CopyBtn onClick={() => copy(company.phone!)} label={`Copy ${company.phone}`} /></span> : null}
            {company.email ? <span className="inline-flex items-center gap-1"><a href={mail(company.email)} className="act"><Mail className="h-3.5 w-3.5" /> {company.email}</a><CopyBtn onClick={() => copy(company.email!)} label={`Copy ${company.email}`} /></span> : null}
            {company.website ? <a href={href(company.website)} target="_blank" rel="noreferrer" className="act"><Globe className="h-3.5 w-3.5" /> {handle(company.website).slice(0, 40)}</a> : null}
            {company.location ? <span className="inline-flex items-center gap-0.5 text-xs text-subtle"><MapPin className="h-3.5 w-3.5" />{company.location}</span> : null}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function CopyBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className="rounded p-1 text-subtle hover:bg-muted hover:text-fg"><Copy className="h-3 w-3" /></button>;
}
