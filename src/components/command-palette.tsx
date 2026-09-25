"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  BarChart3, BookMarked, BookOpen, CalendarCheck, ClipboardList, CornerDownLeft, Download, FileText, FolderOpen,
  HeartPulse, Keyboard, Loader2, Mic, Moon, Plus, Search, Settings, Sun, Target, User, Users,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { SearchHit, SearchKind } from "@/lib/services/search";

// ------------------------------------------------------------------ shortcuts

export const NAV_SHORTCUTS: { keys: string; href: string; label: string; Icon: typeof Sun }[] = [
  { keys: "g t", href: "/today", label: "Today", Icon: Sun },
  { keys: "g p", href: "/plan", label: "Plan", Icon: ClipboardList },
  { keys: "g d", href: "/diary", label: "Diary", Icon: BookOpen },
  { keys: "g r", href: "/review", label: "Review", Icon: CalendarCheck },
  { keys: "g s", href: "/stats", label: "Stats", Icon: BarChart3 },
  { keys: "g o", href: "/goals", label: "Goals", Icon: Target },
  { keys: "g h", href: "/health", label: "Health", Icon: HeartPulse },
  { keys: "g j", href: "/projects", label: "Projects", Icon: FolderOpen },
  { keys: "g c", href: "/contacts", label: "Contacts", Icon: Users },
  { keys: "g f", href: "/refs", label: "References", Icon: BookMarked },
  { keys: "g ,", href: "/settings", label: "Settings", Icon: Settings },
];

export const ACTION_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "Ctrl K", label: "Search everything and run commands" },
  { keys: "n", label: "New task (focus the quick-add bar)" },
  { keys: "r", label: "Record a diary note (on Today or Diary)" },
  { keys: "/", label: "Focus the search box on Projects, Contacts or References" },
  { keys: "t", label: "Switch light / dark / auto theme" },
  { keys: "?", label: "Show these shortcuts" },
  { keys: "Esc", label: "Close a dialog or menu" },
];

/** Typing in a field, or holding a modifier other than for Ctrl/⌘ K, never triggers a shortcut. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox']");
}

function focusQuickAdd() {
  const el = document.getElementById("quick-add-input") as HTMLInputElement | null;
  if (el) {
    el.focus();
    el.scrollIntoView({ block: "nearest" });
  }
}

function cycleTheme() {
  const cur = (localStorage.getItem("daybook-theme") ?? "system") as "system" | "light" | "dark";
  const next = cur === "system" ? "light" : cur === "light" ? "dark" : "system";
  try {
    localStorage.setItem("daybook-theme", next);
  } catch {
    /* ignore */
  }
  document.documentElement.dataset.theme = next === "system" ? "" : next;
  window.dispatchEvent(new CustomEvent("daybook:theme", { detail: next }));
}

// ------------------------------------------------------------------ palette items

interface Item {
  id: string;
  group: string;
  title: string;
  subtitle?: string | null;
  Icon: typeof Sun;
  hint?: string;
  run: () => void;
}

const KIND_ICON: Record<SearchKind, typeof Sun> = {
  task: FileText, project: FolderOpen, contact: User, ref: BookMarked, diary: BookOpen,
};
const KIND_GROUP: Record<SearchKind, string> = {
  task: "Tasks", project: "Projects", contact: "Contacts", ref: "References", diary: "Diary",
};

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingG = useRef<number>(0);

  const go = useCallback((href: string) => {
    setOpen(false);
    router.push(href);
  }, [router]);

  // global keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e) || document.querySelector("[role='dialog']")) return;
      const now = Date.now();
      if (now - pendingG.current < 1200) {
        pendingG.current = 0;
        const hit = NAV_SHORTCUTS.find((s) => s.keys === `g ${e.key.toLowerCase()}`);
        if (hit) {
          e.preventDefault();
          router.push(hit.href);
        }
        return;
      }
      switch (e.key) {
        case "g":
          pendingG.current = now;
          return;
        case "n":
          e.preventDefault();
          focusQuickAdd();
          return;
        case "?":
          e.preventDefault();
          setHelp(true);
          return;
        case "t":
          e.preventDefault();
          cycleTheme();
          return;
        case "r":
          if (pathname === "/today" || pathname === "/diary") {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("daybook:record"));
          }
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  // let other components open the palette (e.g. the sidebar search button)
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onHelp = () => setHelp(true);
    window.addEventListener("daybook:palette", onOpen);
    window.addEventListener("daybook:shortcuts", onHelp);
    return () => {
      window.removeEventListener("daybook:palette", onOpen);
      window.removeEventListener("daybook:shortcuts", onHelp);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  // debounced server search
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const json = (await r.json()) as { hits: SearchHit[] };
        setHits(json.hits ?? []);
      } catch {
        /* aborted or offline */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const items = useMemo<Item[]>(() => {
    const term = query.trim().toLowerCase();
    const match = (s: string) => !term || s.toLowerCase().includes(term);
    const actions: Item[] = [
      { id: "a-new", group: "Actions", title: "New task", Icon: Plus, hint: "n", run: () => { setOpen(false); setTimeout(focusQuickAdd, 50); } },
      { id: "a-diary", group: "Actions", title: "Record today's diary", Icon: Mic, hint: "r", run: () => { go("/diary"); setTimeout(() => window.dispatchEvent(new CustomEvent("daybook:record")), 600); } },
      { id: "a-review", group: "Actions", title: "Review this week", Icon: CalendarCheck, run: () => go("/review") },
      { id: "a-plan", group: "Actions", title: "Plan tomorrow", Icon: ClipboardList, run: () => go("/plan") },
      { id: "a-export", group: "Actions", title: "Export all my data", Icon: Download, run: () => go("/settings#export") },
      { id: "a-theme", group: "Actions", title: "Switch theme", Icon: Moon, hint: "t", run: () => { cycleTheme(); setOpen(false); } },
      { id: "a-keys", group: "Actions", title: "Keyboard shortcuts", Icon: Keyboard, hint: "?", run: () => { setOpen(false); setHelp(true); } },
    ].filter((a) => match(a.title));
    const pages: Item[] = NAV_SHORTCUTS.filter((s) => match(s.label)).map((s) => ({
      id: `p-${s.href}`, group: "Go to", title: s.label, Icon: s.Icon, hint: s.keys, run: () => go(s.href),
    }));
    const results: Item[] = hits.map((h) => ({
      id: h.id, group: KIND_GROUP[h.kind], title: h.title, subtitle: h.subtitle, Icon: KIND_ICON[h.kind], run: () => go(h.href),
    }));
    // with a query, found records come first; without one, actions and pages
    return term.length >= 2 ? [...results, ...pages, ...actions] : [...actions, ...pages];
  }, [query, hits, go]);

  useEffect(() => setActive(0), [query, hits.length]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  }

  let lastGroup = "";
  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay fixed inset-0 z-[70] bg-black/50 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="sheet-content fixed inset-x-3 top-[10vh] z-[71] mx-auto flex max-h-[70vh] max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)]"
          >
            <Dialog.Title className="sr-only">Search and commands</Dialog.Title>
            <div className="flex items-center gap-3 border-b border-border px-4">
              {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-subtle" /> : <Search className="h-4 w-4 shrink-0 text-subtle" />}
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search tasks, projects, people, notes… or type a command"
                aria-label="Search"
                aria-controls="palette-list"
                aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined}
                className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle/70"
              />
              <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-subtle sm:block">Esc</kbd>
            </div>
            <div ref={listRef} id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-subtle">
                  {loading ? "Searching…" : query.trim().length < 2 ? "Type at least 2 letters." : `Nothing found for "${query.trim()}".`}
                </p>
              ) : (
                items.map((it, i) => {
                  const header = it.group !== lastGroup ? it.group : null;
                  lastGroup = it.group;
                  return (
                    <div key={it.id}>
                      {header ? <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-subtle first:pt-1">{header}</p> : null}
                      <div
                        id={`pal-${it.id}`}
                        data-index={i}
                        role="option"
                        aria-selected={i === active}
                        onPointerMove={() => setActive(i)}
                        onClick={() => it.run()}
                        className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2", i === active ? "bg-accent-muted" : "hover:bg-muted")}
                      >
                        <it.Icon className={cn("h-4 w-4 shrink-0", i === active ? "text-accent" : "text-subtle")} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{it.title}</span>
                          {it.subtitle ? <span className="block truncate text-xs text-subtle">{it.subtitle}</span> : null}
                        </span>
                        {it.hint ? <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-subtle">{it.hint}</kbd> : null}
                        {i === active ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden /> : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-subtle">
              <span>↑↓ to move · Enter to open</span>
              <button type="button" onClick={() => { setOpen(false); setHelp(true); }} className="hover:text-fg">All shortcuts <kbd className="ml-1 rounded border border-border px-1">?</kbd></button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={help} onOpenChange={setHelp}>
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay fixed inset-0 z-[70] bg-black/50" />
          <Dialog.Content
            aria-describedby={undefined}
            className="sheet-content fixed inset-x-3 top-[8vh] z-[71] mx-auto max-h-[84vh] max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-lg)]"
          >
            <Dialog.Title className="flex items-center gap-2 font-display text-xl">
              <Keyboard className="h-5 w-5 text-accent" /> Keyboard shortcuts
            </Dialog.Title>
            <p className="mt-1 text-sm text-subtle">Shortcuts work anywhere except while typing in a field.</p>
            <div className="mt-5 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Actions</p>
                <ul className="space-y-2">
                  {ACTION_SHORTCUTS.map((s) => (
                    <li key={s.keys} className="flex items-center justify-between gap-3 text-sm">
                      <span>{s.label}</span>
                      <Keys k={s.keys} />
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Go to (press g, then the letter)</p>
                <ul className="space-y-2">
                  {NAV_SHORTCUTS.map((s) => (
                    <li key={s.keys} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2"><s.Icon className="h-4 w-4 text-subtle" /> {s.label}</span>
                      <Keys k={s.keys} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Dialog.Close className="h-9 rounded-xl bg-muted px-4 text-sm font-medium hover:bg-border">Close</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Keys({ k }: { k: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {k.split(" ").map((p, i) => (
        <kbd key={i} className="min-w-[1.5rem] rounded-md border border-border bg-bg px-1.5 py-0.5 text-center text-[11px] font-semibold text-fg shadow-[0_1px_0_hsl(var(--border))]">
          {p === "Ctrl" ? "Ctrl/⌘" : p}
        </kbd>
      ))}
    </span>
  );
}
