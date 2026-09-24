"use client";

import {
  ExternalLink, FileText, Link2, Pencil, Pin, Plus, Quote, Search, Tag, Trash2, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createRefAction, deleteRefAction, updateRefAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import type { Ref, RefKind } from "@/lib/services/refs";
import { Button, Card, Empty, Input, Sheet, Textarea } from "../ui";
import { VoiceButton } from "../voice-button";

// ─── helpers ─────────────────────────────────────────────────────────────────

const KIND_META: Record<RefKind, { label: string; Icon: typeof Link2; color: string }> = {
  link:  { label: "Link",  Icon: Link2,    color: "text-accent bg-accent/10" },
  note:  { label: "Note",  Icon: FileText,  color: "text-good bg-good/10" },
  quote: { label: "Quote", Icon: Quote,     color: "text-warn bg-warn/10" },
};

function kindIcon(kind: RefKind) {
  const { Icon, color } = KIND_META[kind];
  return (
    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm", color)}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function TagPill({ tag, active, onClick }: { tag: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-accent-fg"
          : "border border-border text-subtle hover:bg-muted hover:text-fg",
      )}
    >
      <Tag className="h-3 w-3" /> {tag}
    </button>
  );
}

// ─── form ─────────────────────────────────────────────────────────────────────

type FormData = Omit<Ref, "id" | "created_at">;

const BLANK: FormData = {
  kind: "link", title: "", url: null, body: null, source: null, tags: [], pinned: false,
};

function RefForm({
  initial,
  pending,
  allTags,
  voiceEnabled,
  onSubmit,
  onCancel,
}: {
  initial: FormData;
  pending: boolean;
  allTags: string[];
  voiceEnabled: boolean;
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormData>(initial);
  const set = <K extends keyof FormData>(k: K, v: FormData[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const [tagInput, setTagInput] = useState(f.tags.join(", "));

  const updateTags = (raw: string) => {
    setTagInput(raw);
    set("tags", raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean));
  };

  const toggleSuggestedTag = (tag: string) => {
    const has = f.tags.includes(tag);
    const next = has ? f.tags.filter((t) => t !== tag) : [...f.tags, tag];
    setF((p) => ({ ...p, tags: next }));
    setTagInput(next.join(", "));
  };

  return (
    <div className="space-y-4">
      {/* kind picker */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-subtle">Type</p>
        <div className="flex gap-2">
          {(["link", "note", "quote"] as RefKind[]).map((k) => {
            const { label, Icon, color } = KIND_META[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => set("kind", k)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-sm font-medium transition-colors",
                  f.kind === k
                    ? cn("border-transparent", color)
                    : "border-border text-subtle hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* title */}
      <div>
        <label className="mb-1 block text-xs font-medium text-subtle">
          {f.kind === "quote" ? "Quote text *" : "Title *"}
        </label>
        <Input
          value={f.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={
            f.kind === "link" ? "GPT-4 technical report"
            : f.kind === "quote" ? "The best time to plant a tree was…"
            : "My note title"
          }
        />
      </div>

      {/* url — only for links */}
      {f.kind === "link" ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-subtle">URL</label>
          <Input
            type="url"
            value={f.url ?? ""}
            onChange={(e) => set("url", e.target.value || null)}
            placeholder="https://…"
          />
        </div>
      ) : null}

      {/* source — for quotes */}
      {f.kind === "quote" ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-subtle">Source / Author</label>
          <Input
            value={f.source ?? ""}
            onChange={(e) => set("source", e.target.value || null)}
            placeholder="Naval Ravikant, Almanack of Naval"
          />
        </div>
      ) : null}

      {/* body — description for links, content for notes */}
      {f.kind !== "quote" ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-subtle">
            {f.kind === "link" ? "Description (optional)" : "Content *"}
          </label>
          <div className="flex items-start gap-2">
            <Textarea
              value={f.body ?? ""}
              onChange={(e) => set("body", e.target.value || null)}
              placeholder={f.kind === "link" ? "What is this link about?" : "Write your note here…"}
              className="min-h-[80px]"
            />
            <VoiceButton
              enabled={voiceEnabled}
              onText={(t) => set("body", f.body ? `${f.body} ${t}` : t)}
            />
          </div>
        </div>
      ) : null}

      {/* tags */}
      <div>
        <label className="mb-1 block text-xs font-medium text-subtle">Tags (comma-separated)</label>
        <Input
          value={tagInput}
          onChange={(e) => updateTags(e.target.value)}
          placeholder="ai, productivity, tools"
        />
        {allTags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {allTags.slice(0, 20).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleSuggestedTag(t)}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                  f.tags.includes(t)
                    ? "bg-accent text-accent-fg"
                    : "bg-muted text-subtle hover:text-fg",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* pin */}
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.pinned}
          onChange={(e) => set("pinned", e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        Pin to top
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          disabled={pending || !f.title.trim()}
          onClick={() => onSubmit(f)}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

// ─── ref card ─────────────────────────────────────────────────────────────────

function RefCard({
  ref: r,
  onEdit,
  onDelete,
  onTogglePin,
  pending,
}: {
  ref: Ref;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  pending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isQuote = r.kind === "quote";
  const hasBody = r.kind !== "quote" && r.body;

  return (
    <Card className={cn("overflow-hidden transition-shadow", r.pinned && "ring-1 ring-accent/30")}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          {kindIcon(r.kind)}
          <div className="min-w-0 flex-1">
            {/* quote renders differently */}
            {isQuote ? (
              <blockquote className="border-l-2 border-warn/60 pl-3">
                <p className="text-sm font-medium leading-snug text-fg">{r.title}</p>
                {r.source ? (
                  <footer className="mt-1 text-xs text-subtle">— {r.source}</footer>
                ) : null}
              </blockquote>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium leading-snug text-fg">{r.title}</p>
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-lg p-1 text-subtle hover:bg-muted hover:text-accent"
                      aria-label="Open link"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
                {r.url ? (
                  <p className="mt-0.5 truncate text-xs text-subtle">{r.url}</p>
                ) : null}
              </>
            )}

            {/* tags */}
            {r.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {r.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-subtle"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}

            {/* body preview for notes / link descriptions */}
            {hasBody ? (
              <>
                {expanded ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-subtle">{r.body}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1.5 text-xs font-medium text-accent hover:underline underline-offset-2"
                >
                  {expanded ? "Hide" : "Show description"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* action bar */}
      <div className="flex items-center justify-end gap-0.5 border-t border-border/50 px-3 py-1.5">
        <button
          type="button"
          onClick={onTogglePin}
          title={r.pinned ? "Unpin" : "Pin to top"}
          className={cn(
            "rounded-lg p-1.5 transition-colors",
            r.pinned ? "text-accent" : "text-subtle hover:text-accent hover:bg-muted",
          )}
        >
          <Pin className="h-3.5 w-3.5" style={r.pinned ? { fill: "currentColor" } : undefined} />
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg p-1.5 text-subtle hover:bg-muted hover:text-fg"
          aria-label="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="rounded-lg p-1.5 text-subtle hover:bg-bad/10 hover:text-bad"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </Card>
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────

export function RefsClient({ refs, allTags, voiceEnabled }: { refs: Ref[]; allTags: string[]; voiceEnabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<RefKind | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Ref | null>(null);
  const [addKind, setAddKind] = useState<RefKind>("link");

  function call(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => { await fn(); router.refresh(); });
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return refs.filter((r) => {
      if (activeTag && !r.tags.includes(activeTag)) return false;
      if (kindFilter && r.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.url ?? "").toLowerCase().includes(q) ||
        (r.body ?? "").toLowerCase().includes(q) ||
        (r.source ?? "").toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [refs, search, activeTag, kindFilter]);

  const counts = useMemo(
    () => ({
      link: refs.filter((r) => r.kind === "link").length,
      note: refs.filter((r) => r.kind === "note").length,
      quote: refs.filter((r) => r.kind === "quote").length,
    }),
    [refs],
  );

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">References</h1>
          <p className="mt-1 text-sm text-subtle">
            Links, notes, and quotes — all searchable by tag or keyword.
          </p>
        </div>
        <div className="flex gap-2">
          {(["link", "note", "quote"] as RefKind[]).map((k) => {
            const { label, Icon } = KIND_META[k];
            return (
              <Button
                key={k}
                variant="outline"
                size="sm"
                onClick={() => { setAddKind(k); setAddOpen(true); }}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
                <Plus className="h-3 w-3" />
              </Button>
            );
          })}
        </div>
      </div>

      {refs.length > 0 ? (
        <>
          {/* search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search links, notes, quotes, tags…"
              className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-9 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
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

          {/* kind + tag filters */}
          <div className="flex flex-wrap items-center gap-2">
            {(["link", "note", "quote"] as RefKind[]).map((k) => {
              const { label, Icon } = KIND_META[k];
              if (!counts[k]) return null;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(kindFilter === k ? null : k)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    kindFilter === k
                      ? "bg-accent text-accent-fg"
                      : "border border-border text-subtle hover:bg-muted hover:text-fg",
                  )}
                >
                  <Icon className="h-3 w-3" /> {label}s
                  <span className="opacity-70">{counts[k]}</span>
                </button>
              );
            })}

            {allTags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {allTags.map((t) => (
                  <TagPill
                    key={t}
                    tag={t}
                    active={activeTag === t}
                    onClick={() => setActiveTag(activeTag === t ? null : t)}
                  />
                ))}
              </div>
            ) : null}

            {(activeTag || kindFilter || search) ? (
              <button
                type="button"
                onClick={() => { setActiveTag(null); setKindFilter(null); setSearch(""); }}
                className="flex items-center gap-1 text-xs text-subtle hover:text-fg"
              >
                <X className="h-3.5 w-3.5" /> Clear filters
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {/* results */}
      {refs.length === 0 ? (
        <Empty>
          Nothing saved yet. Add a link, note, or quote using the buttons above.
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>No results match your search or filters.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((r) => (
            <RefCard
              key={r.id}
              ref={r}
              onEdit={() => setEditing(r)}
              onDelete={() => call(() => deleteRefAction(r.id))}
              onTogglePin={() => call(() => updateRefAction(r.id, { pinned: !r.pinned }))}
              pending={pending}
            />
          ))}
        </div>
      )}

      {/* count */}
      {filtered.length > 0 && refs.length > 0 ? (
        <p className="text-xs text-subtle">
          {filtered.length === refs.length
            ? `${refs.length} saved`
            : `${filtered.length} of ${refs.length}`}
        </p>
      ) : null}

      {/* add sheet */}
      <Sheet open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)} title="Add reference">
        <RefForm
          initial={{ ...BLANK, kind: addKind }}
          pending={pending}
          allTags={allTags}
          voiceEnabled={voiceEnabled}
          onSubmit={(data) => {
            call(() => createRefAction(data));
            setAddOpen(false);
          }}
          onCancel={() => setAddOpen(false)}
        />
      </Sheet>

      {/* edit sheet */}
      <Sheet
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing ? `Edit · ${editing.title}` : "Edit"}
      >
        {editing ? (
          <RefForm
            key={editing.id}
            initial={{
              kind: editing.kind, title: editing.title, url: editing.url,
              body: editing.body, source: editing.source, tags: editing.tags, pinned: editing.pinned,
            }}
            pending={pending}
            allTags={allTags}
            voiceEnabled={voiceEnabled}
            onSubmit={(data) => {
              call(() => updateRefAction(editing.id, data));
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
