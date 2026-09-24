"use client";

import {
  Building2, Mail, MapPin, Pencil, Phone, Plus, Search, Tag, Trash2, X, ExternalLink,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { createContactAction, deleteContactAction, updateContactAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import type { Contact } from "@/lib/services/contacts";
import { Button, Card, Empty, Input, Sheet, Textarea, inputClass } from "../ui";
import { VoiceButton } from "../voice-button";

// ─── helpers ────────────────────────────────────────────────────────────────

function splitComma(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

// ─── tag chip input ──────────────────────────────────────────────────────────

function TagChipInput({
  tags,
  onChange,
  suggestions,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () =>
      input.trim()
        ? suggestions.filter(
            (s) => s.toLowerCase().includes(input.toLowerCase()) && !tags.includes(s),
          )
        : [],
    [input, suggestions, tags],
  );

  function add(tag: string) {
    const clean = tag.trim().toLowerCase();
    if (clean && !tags.includes(clean)) onChange([...tags, clean]);
    setInput("");
    inputRef.current?.focus();
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "Enter" || e.key === ",") && input.trim()) {
      e.preventDefault();
      add(input);
    }
    if (e.key === "Backspace" && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-subtle">Tags</label>
      <div
        className="relative flex min-h-[38px] flex-wrap gap-1 rounded-xl border border-border bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
          >
            {t}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(tags.filter((x) => x !== t)); }}
              className="ml-0.5 opacity-60 hover:opacity-100"
              aria-label={`Remove ${t}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={tags.length === 0 ? "investor, mentor… (Enter or comma to add)" : ""}
          className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-subtle/50"
        />
        {filtered.length > 0 ? (
          <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-xl border border-border bg-surface shadow-lg overflow-hidden">
            {filtered.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); add(s); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
              >
                <Tag className="h-3 w-3 text-subtle" /> {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── array text field ────────────────────────────────────────────────────────

function ArrayField({
  label, value, onChange, placeholder, type,
}: {
  label: string; value: string; onChange: (raw: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-subtle">
        {label} <span className="font-normal opacity-60">comma-separated</span>
      </label>
      <Input type={type ?? "text"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? ""} />
    </div>
  );
}

function TextField({
  label, value, onChange, placeholder, type,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-subtle">{label}</label>
      <Input type={type ?? "text"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? ""} />
    </div>
  );
}

// ─── contact form ────────────────────────────────────────────────────────────

type FormData = Omit<Contact, "id" | "created_at">;

const BLANK: FormData = {
  name: "", cities: [], companies: [], roles: [],
  phones: [], emails: [], linkedin: null, notes: null, tags: [],
};

function toRaw(f: FormData) {
  return {
    cities: f.cities.join(", "),
    companies: f.companies.join(", "),
    roles: f.roles.join(", "),
    phones: f.phones.join(", "),
    emails: f.emails.join(", "),
  };
}

function ContactForm({
  initial, pending, voiceEnabled, allTags, onSubmit, onCancel,
}: {
  initial: FormData;
  pending: boolean;
  voiceEnabled: boolean;
  allTags: string[];
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormData>(initial);
  const [raw, setRaw] = useState(() => toRaw(initial));

  function handleArr(field: keyof typeof raw, value: string) {
    setRaw((r) => ({ ...r, [field]: value }));
    setF((p) => ({ ...p, [field]: splitComma(value) }));
  }

  return (
    <div className="space-y-3">
      <TextField label="Name *" value={f.name} onChange={(v) => setF((p) => ({ ...p, name: v }))} />
      <div className="grid grid-cols-2 gap-3">
        <ArrayField label="City" value={raw.cities} onChange={(v) => handleArr("cities", v)} placeholder="Mumbai, Bangalore…" />
        <ArrayField label="Company" value={raw.companies} onChange={(v) => handleArr("companies", v)} placeholder="Acme, Refurbit…" />
      </div>
      <ArrayField label="Role / Title" value={raw.roles} onChange={(v) => handleArr("roles", v)} placeholder="Founder, Decision Maker…" />
      <div className="grid grid-cols-2 gap-3">
        <ArrayField label="Phone" value={raw.phones} onChange={(v) => handleArr("phones", v)} placeholder="+91 98765…" />
        <ArrayField label="Email" value={raw.emails} onChange={(v) => handleArr("emails", v)} placeholder="a@co.com…" />
      </div>
      <TextField
        label="LinkedIn URL"
        value={f.linkedin ?? ""}
        onChange={(v) => setF((p) => ({ ...p, linkedin: v || null }))}
        placeholder="linkedin.com/in/…"
      />
      <TagChipInput
        tags={f.tags}
        onChange={(tags) => setF((p) => ({ ...p, tags }))}
        suggestions={allTags}
      />
      <div>
        <label className="mb-1 block text-xs font-medium text-subtle">Notes</label>
        <div className="flex items-start gap-2">
          <Textarea
            value={f.notes ?? ""}
            onChange={(e) => setF((p) => ({ ...p, notes: e.target.value || null }))}
            placeholder="Met at DevFest 2024. Interested in SaaS tools."
            className="min-h-[80px]"
          />
          <VoiceButton
            enabled={voiceEnabled}
            onText={(t) => setF((p) => ({ ...p, notes: p.notes ? `${p.notes} ${t}` : t }))}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={pending || !f.name.trim()} onClick={() => onSubmit(f)}>
          Save
        </Button>
      </div>
    </div>
  );
}

// ─── confirm delete dialog ───────────────────────────────────────────────────

function ConfirmDelete({
  name, onConfirm, onCancel, pending,
}: {
  name: string; onConfirm: () => void; onCancel: () => void; pending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl space-y-4">
        <h2 className="text-base font-semibold">Delete contact?</h2>
        <p className="text-sm text-subtle">
          <span className="font-medium text-fg">{name}</span> will be permanently removed. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-xl bg-bad px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── contact card ─────────────────────────────────────────────────────────────

function ContactCard({
  contact, onEdit, onDelete, pending,
}: {
  contact: Contact; onEdit: () => void; onDelete: () => void; pending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold leading-snug">{contact.name}</h3>
            <div className="mt-1 space-y-0.5 text-xs text-subtle">
              {contact.roles.length > 0 && (
                <p>{contact.roles.join(" · ")}</p>
              )}
              {contact.companies.length > 0 && (
                <p className="flex items-center gap-1 flex-wrap">
                  <Building2 className="h-3 w-3 shrink-0" />
                  {contact.companies.map((co, i) => (
                    <span key={co}>
                      {co}{i < contact.companies.length - 1 ? <span className="mx-0.5 opacity-40">·</span> : null}
                    </span>
                  ))}
                </p>
              )}
              {contact.cities.length > 0 && (
                <p className="flex items-center gap-1 flex-wrap">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {contact.cities.map((ci, i) => (
                    <span key={ci}>
                      {ci}{i < contact.cities.length - 1 ? <span className="mx-0.5 opacity-40">·</span> : null}
                    </span>
                  ))}
                </p>
              )}
            </div>
            {contact.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {contact.tags.map((t) => (
                  <span key={t} className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={onEdit} className="rounded-lg p-1.5 text-subtle hover:bg-muted hover:text-fg" aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </button>
            <button type="button" onClick={onDelete} disabled={pending} className="rounded-lg p-1.5 text-subtle hover:bg-bad/10 hover:text-bad" aria-label="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {contact.phones.map((ph) => (
            <a key={ph} href={`tel:${ph}`} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-fg hover:bg-muted">
              <Phone className="h-3.5 w-3.5 text-subtle" /> {ph}
            </a>
          ))}
          {contact.emails.map((em) => (
            <a key={em} href={`mailto:${em}`} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-fg hover:bg-muted">
              <Mail className="h-3.5 w-3.5 text-subtle" /> {em}
            </a>
          ))}
          {contact.linkedin ? (
            <a
              href={contact.linkedin.startsWith("http") ? contact.linkedin : `https://${contact.linkedin}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-fg hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5 text-subtle" /> LinkedIn
            </a>
          ) : null}
        </div>

        {contact.notes ? (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-xs font-medium text-accent hover:underline underline-offset-2">
            {expanded ? "Hide notes" : "Show notes"}
          </button>
        ) : null}
      </div>
      {expanded && contact.notes ? (
        <div className="border-t border-border px-4 py-3">
          <p className="whitespace-pre-wrap text-sm text-subtle">{contact.notes}</p>
        </div>
      ) : null}
    </Card>
  );
}

// ─── filter pill ─────────────────────────────────────────────────────────────

function FilterPill({
  label, count, active, onClick, icon,
}: {
  label: string; count?: number; active: boolean; onClick: () => void; icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-accent-fg"
          : "border border-border text-subtle hover:bg-muted hover:text-fg",
      )}
    >
      {icon}
      {label}
      {count !== undefined ? <span className="ml-0.5 opacity-70">{count}</span> : null}
    </button>
  );
}

// ─── main client ─────────────────────────────────────────────────────────────

export function ContactsClient({
  contacts,
  voiceEnabled,
}: {
  contacts: Contact[];
  voiceEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState("");
  const [cityFilters, setCityFilters] = useState<Set<string>>(new Set());
  const [tagFilters, setTagFilters] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  function call(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => { await fn(); router.refresh(); });
  }

  function toggleCity(city: string) {
    setCityFilters((prev) => {
      const next = new Set(prev);
      next.has(city) ? next.delete(city) : next.add(city);
      return next;
    });
  }

  function toggleTag(tag: string) {
    setTagFilters((prev) => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  }

  // all unique cities and tags
  const allCities = useMemo(() => {
    const s = new Set<string>();
    for (const c of contacts) c.cities.forEach((ci) => s.add(ci));
    return Array.from(s).sort();
  }, [contacts]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const c of contacts) c.tags.forEach((t) => s.add(t));
    return Array.from(s).sort();
  }, [contacts]);

  // per-city and per-tag contact counts (unfiltered)
  const cityCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts) c.cities.forEach((ci) => m.set(ci, (m.get(ci) ?? 0) + 1));
    return m;
  }, [contacts]);

  const tagCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts) c.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1));
    return m;
  }, [contacts]);

  const filtered = useMemo(() => {
    const sq = search.toLowerCase();
    return contacts
      .filter((c) => {
        if (cityFilters.size > 0 && !c.cities.some((ci) => cityFilters.has(ci))) return false;
        if (tagFilters.size > 0 && !c.tags.some((t) => tagFilters.has(t))) return false;
        if (!sq) return true;
        return (
          c.name.toLowerCase().includes(sq) ||
          c.cities.some((v) => v.toLowerCase().includes(sq)) ||
          c.companies.some((v) => v.toLowerCase().includes(sq)) ||
          c.roles.some((v) => v.toLowerCase().includes(sq)) ||
          c.phones.some((v) => v.toLowerCase().includes(sq)) ||
          c.emails.some((v) => v.toLowerCase().includes(sq)) ||
          c.tags.some((v) => v.toLowerCase().includes(sq)) ||
          (c.notes ?? "").toLowerCase().includes(sq)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, search, cityFilters, tagFilters]);

  const hasFilters = search || cityFilters.size > 0 || tagFilters.size > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Contacts</h1>
          <p className="mt-1 text-sm text-subtle">
            {contacts.length} {contacts.length === 1 ? "person" : "people"} · filter by city or tag below
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {contacts.length > 0 && (
        <div className="space-y-3">
          {/* search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, company, role, phone, email, tag, notes…"
              className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-4 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {search ? (
              <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {/* city filter */}
          {allCities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="self-center text-[11px] font-medium uppercase tracking-wide text-subtle mr-1">City</span>
              {allCities.map((city) => (
                <FilterPill
                  key={city}
                  label={city}
                  count={cityCount.get(city)}
                  active={cityFilters.has(city)}
                  onClick={() => toggleCity(city)}
                  icon={<MapPin className="h-3 w-3" />}
                />
              ))}
            </div>
          )}

          {/* tag filter */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="self-center text-[11px] font-medium uppercase tracking-wide text-subtle mr-1">Tag</span>
              {allTags.map((tag) => (
                <FilterPill
                  key={tag}
                  label={tag}
                  count={tagCount.get(tag)}
                  active={tagFilters.has(tag)}
                  onClick={() => toggleTag(tag)}
                  icon={<Tag className="h-3 w-3" />}
                />
              ))}
            </div>
          )}

          {/* active filter summary + clear */}
          {hasFilters && (
            <div className="flex items-center justify-between text-xs text-subtle">
              <span>
                Showing {filtered.length} of {contacts.length}
              </span>
              {(cityFilters.size > 0 || tagFilters.size > 0) && (
                <button
                  type="button"
                  onClick={() => { setCityFilters(new Set()); setTagFilters(new Set()); }}
                  className="text-accent hover:underline underline-offset-2"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* contact list – flat alphabetical, no grouping */}
      {contacts.length === 0 ? (
        <Empty>No contacts yet. Hit Add to save your first one.</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No contacts match your search or filters.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((c) => (
            <ContactCard
              key={c.id}
              contact={c}
              onEdit={() => setEditing(c)}
              onDelete={() => setDeleting(c)}
              pending={pending}
            />
          ))}
        </div>
      )}

      {/* confirm delete */}
      {deleting ? (
        <ConfirmDelete
          name={deleting.name}
          pending={pending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            call(() => deleteContactAction(deleting.id));
            setDeleting(null);
          }}
        />
      ) : null}

      {/* add sheet */}
      <Sheet open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)} title="Add contact">
        <ContactForm
          initial={BLANK}
          pending={pending}
          voiceEnabled={voiceEnabled}
          allTags={allTags}
          onSubmit={(data) => { call(() => createContactAction(data)); setAddOpen(false); }}
          onCancel={() => setAddOpen(false)}
        />
      </Sheet>

      {/* edit sheet */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing ? `Edit · ${editing.name}` : "Edit contact"}>
        {editing ? (
          <ContactForm
            key={editing.id}
            initial={{
              name: editing.name,
              cities: editing.cities,
              companies: editing.companies,
              roles: editing.roles,
              phones: editing.phones,
              emails: editing.emails,
              linkedin: editing.linkedin,
              notes: editing.notes,
              tags: editing.tags,
            }}
            pending={pending}
            voiceEnabled={voiceEnabled}
            allTags={allTags}
            onSubmit={(data) => { call(() => updateContactAction(editing.id, data)); setEditing(null); }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
