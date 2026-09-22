"use client";

import {
  Building2, Mail, MapPin, Pencil, Phone, Plus, Search, Trash2, UserRound, X, ExternalLink,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createContactAction, deleteContactAction, updateContactAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import type { Contact } from "@/lib/services/contacts";
import { Button, Card, Empty, Input, Sheet, Textarea } from "../ui";

// ─── contact form ──────────────────────────────────────────────────────────

type FormData = Omit<Contact, "id" | "created_at">;

const BLANK: FormData = {
  name: "", city: null, company: null, role: null,
  phone: null, email: null, linkedin: null, notes: null, tags: [],
};

function field(
  label: string,
  value: string,
  onChange: (v: string) => void,
  opts?: { placeholder?: string; type?: string },
) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-subtle">{label}</label>
      <Input
        type={opts?.type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={opts?.placeholder ?? ""}
      />
    </div>
  );
}

function ContactForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: FormData;
  pending: boolean;
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormData>(initial);
  const set = (k: keyof FormData, v: string | null) =>
    setF((prev) => ({ ...prev, [k]: v || null }));
  const [tagInput, setTagInput] = useState(f.tags.join(", "));

  return (
    <div className="space-y-3">
      {field("Name *", f.name, (v) => setF((p) => ({ ...p, name: v })))}
      <div className="grid grid-cols-2 gap-3">
        {field("City", f.city ?? "", (v) => set("city", v), { placeholder: "Mumbai, Bangalore…" })}
        {field("Company", f.company ?? "", (v) => set("company", v))}
      </div>
      {field("Role / Title", f.role ?? "", (v) => set("role", v), { placeholder: "Founder, Engineer…" })}
      <div className="grid grid-cols-2 gap-3">
        {field("Phone", f.phone ?? "", (v) => set("phone", v), { placeholder: "+91 98765…", type: "tel" })}
        {field("Email", f.email ?? "", (v) => set("email", v), { type: "email" })}
      </div>
      {field("LinkedIn URL", f.linkedin ?? "", (v) => set("linkedin", v), { placeholder: "linkedin.com/in/…" })}
      <div>
        <label className="mb-1 block text-xs font-medium text-subtle">Tags (comma-separated)</label>
        <Input
          value={tagInput}
          onChange={(e) => {
            setTagInput(e.target.value);
            setF((p) => ({
              ...p,
              tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
            }));
          }}
          placeholder="investor, vc, mentor…"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-subtle">Notes</label>
        <Textarea
          value={f.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Met at DevFest 2024. Interested in SaaS tools."
          className="min-h-[80px]"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          disabled={pending || !f.name.trim()}
          onClick={() => onSubmit(f)}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

// ─── contact card ───────────────────────────────────────────────────────────

function ContactCard({
  contact,
  onEdit,
  onDelete,
  pending,
}: {
  contact: Contact;
  onEdit: () => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold leading-snug">{contact.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
              {contact.role ? <span>{contact.role}</span> : null}
              {contact.company ? (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> {contact.company}
                </span>
              ) : null}
              {contact.city ? (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {contact.city}
                </span>
              ) : null}
            </div>
            {contact.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {contact.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg p-1.5 text-subtle hover:bg-muted hover:text-fg"
              aria-label="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-lg p-1.5 text-subtle hover:bg-bad/10 hover:text-bad"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* quick-reach links */}
        <div className="mt-3 flex flex-wrap gap-2">
          {contact.phone ? (
            <a
              href={`tel:${contact.phone}`}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-fg hover:bg-muted"
            >
              <Phone className="h-3.5 w-3.5 text-subtle" /> {contact.phone}
            </a>
          ) : null}
          {contact.email ? (
            <a
              href={`mailto:${contact.email}`}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-fg hover:bg-muted"
            >
              <Mail className="h-3.5 w-3.5 text-subtle" /> {contact.email}
            </a>
          ) : null}
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
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 text-xs font-medium text-accent hover:underline underline-offset-2"
          >
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

// ─── main client ────────────────────────────────────────────────────────────

export function ContactsClient({ contacts }: { contacts: Contact[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  function call(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  const cities = useMemo(() => {
    const s = new Set(contacts.map((c) => c.city).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [contacts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return contacts.filter((c) => {
      if (cityFilter && c.city !== cityFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.company ?? "").toLowerCase().includes(q) ||
        (c.role ?? "").toLowerCase().includes(q) ||
        (c.city ?? "").toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [contacts, search, cityFilter]);

  // group by city for display
  const grouped = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filtered) {
      const key = c.city ?? "No city";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Contacts</h1>
          <p className="mt-1 text-sm text-subtle">
            People you know, grouped by city. Tap a city to filter.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {/* search + city filter */}
      {contacts.length > 0 ? (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, company, role, tag…"
              className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-4 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {cities.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {cities.map((city) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => setCityFilter(cityFilter === city ? null : city)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    cityFilter === city
                      ? "bg-accent text-accent-fg"
                      : "border border-border text-subtle hover:bg-muted hover:text-fg",
                  )}
                >
                  <MapPin className="h-3 w-3" /> {city}
                  <span className="ml-1 opacity-70">
                    {contacts.filter((c) => c.city === city).length}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* contact list */}
      {contacts.length === 0 ? (
        <Empty>
          No contacts yet. Hit Add to save your first one.
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>No contacts match your search.</Empty>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([city, people]) => (
            <section key={city} className="space-y-3">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
                <MapPin className="h-3.5 w-3.5" /> {city}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-fg">
                  {people.length}
                </span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {people.map((c) => (
                  <ContactCard
                    key={c.id}
                    contact={c}
                    onEdit={() => setEditing(c)}
                    onDelete={() => call(() => deleteContactAction(c.id))}
                    pending={pending}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* add sheet */}
      <Sheet open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)} title="Add contact">
        <ContactForm
          initial={BLANK}
          pending={pending}
          onSubmit={(data) => {
            call(() => createContactAction(data));
            setAddOpen(false);
          }}
          onCancel={() => setAddOpen(false)}
        />
      </Sheet>

      {/* edit sheet */}
      <Sheet
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing ? `Edit · ${editing.name}` : "Edit contact"}
      >
        {editing ? (
          <ContactForm
            key={editing.id}
            initial={{
              name: editing.name,
              city: editing.city,
              company: editing.company,
              role: editing.role,
              phone: editing.phone,
              email: editing.email,
              linkedin: editing.linkedin,
              notes: editing.notes,
              tags: editing.tags,
            }}
            pending={pending}
            onSubmit={(data) => {
              call(() => updateContactAction(editing.id, data));
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
