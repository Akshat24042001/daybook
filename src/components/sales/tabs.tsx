"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export interface TabDef {
  key: string;
  label: string;
  /** a small number after the label (how many items are inside) */
  count?: number | null;
  /** other names that open this tab from the address (#documents opens "docs") */
  aliases?: string[];
  content: React.ReactNode;
}

/**
 * The second step of a page: everything you may want to look at, one tab at a time, with "Everything" to see it all
 * on one page. A tab is drawn the first time you open it and then kept, so a half-written form survives switching.
 * The last tab you used is remembered on this device; a link to #name opens that tab.
 */
export function Tabs({ id, tabs, label = "More about this lead" }: { id: string; tabs: TabDef[]; label?: string }) {
  const all: TabDef = { key: "all", label: "Everything", content: null };
  const list = [...tabs, all];
  const [active, setActive] = useState(tabs[0]?.key ?? "all");
  const [seen, setSeen] = useState<Set<string>>(() => new Set([tabs[0]?.key ?? "all"]));
  const pick = (k: string, remember = true) => {
    setActive(k);
    setSeen((s) => (s.has(k) ? s : new Set(s).add(k)));
    if (remember) try { localStorage.setItem(`tabs:${id}`, k); } catch { /* private mode */ }
  };
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.replace(/^#/, "").toLowerCase();
      const t = hash ? list.find((x) => x.key === hash || x.aliases?.includes(hash)) : undefined;
      if (t) pick(t.key, false);
      return !!t;
    };
    if (!fromHash()) {
      try {
        const v = localStorage.getItem(`tabs:${id}`);
        if (v && list.some((t) => t.key === v)) pick(v, false);
      } catch { /* private mode */ }
    }
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const show = (k: string) => active === "all" || active === k;
  return (
    <section aria-label={label} className="space-y-3">
      <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 [scrollbar-width:none]">
        {list.map((t) => (
          <button
            key={t.key} type="button" role="tab" data-tab={t.key} aria-selected={active === t.key} aria-controls={`${id}-panel-${t.key}`}
            onClick={() => pick(t.key)}
            className={cn("-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
              active === t.key ? "border-accent font-semibold text-accent" : "border-transparent text-subtle hover:text-fg")}
          >
            {t.label}{t.count ? <span className="ml-1 rounded-full bg-muted px-1.5 text-[11px] text-subtle">{t.count}</span> : null}
          </button>
        ))}
      </div>
      {tabs.map((t) => (active === "all" || seen.has(t.key) ? (
        <div key={t.key} id={`${id}-panel-${t.key}`} role="tabpanel" aria-label={t.label} hidden={!show(t.key)} className="space-y-4">
          {active === "all" ? <h3 className="font-display text-lg">{t.label}</h3> : null}
          {t.content}
        </div>
      ) : null))}
    </section>
  );
}
