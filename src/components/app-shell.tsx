"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  BarChart3, BookMarked, BookOpen, Bot, Briefcase, CalendarCheck, ClipboardList, FolderOpen, HeartPulse, KanbanSquare, LayoutGrid, Monitor, Moon, PenLine, Radar, Settings, Sun, Target,
  History, Search, Users, X, Building2, ListChecks, Undo2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { HUE, hueForPath, type Hue } from "@/lib/hue";
import { PALETTES, applyTheme, getPalette, getThemePref, setPalette, setThemePref, type PaletteId, type ThemePref } from "@/lib/theme";
import { CommandPalette } from "./command-palette";
import { NavProgress } from "./nav-progress";
import { QuickAdd } from "./quick-add";
import { StaleBanner } from "./stale-banner";
import { ToastProvider } from "./toast";
import { UndoWatcher, type RecentAction } from "./undo-watcher";

function useTheme() {
  const [theme, setTheme] = useState<ThemePref>("system");
  useEffect(() => {
    setTheme(getThemePref());
    // the "t" shortcut switches theme too: keep the label in sync
    const onTheme = (e: Event) => setTheme((e as CustomEvent<ThemePref>).detail);
    window.addEventListener("daybook:theme", onTheme);
    return () => window.removeEventListener("daybook:theme", onTheme);
  }, []);
  const cycle = () => setThemePref(theme === "system" ? "light" : theme === "light" ? "dark" : "system");
  return { theme, cycle };
}

/** The chosen pastel palette ("candy" = each page in its own pastel). */
function usePalette() {
  const [palette, setPaletteState] = useState<PaletteId>("candy");
  useEffect(() => {
    setPaletteState(getPalette());
    const on = (e: Event) => setPaletteState((e as CustomEvent<PaletteId>).detail);
    window.addEventListener("daybook:palette-change", on);
    return () => window.removeEventListener("daybook:palette-change", on);
  }, []);
  const next = () => setPalette(PALETTES[(PALETTES.findIndex((p) => p.id === palette) + 1) % PALETTES.length].id);
  return { palette, next };
}

function ThemeToggle() {
  const { theme, cycle } = useTheme();
  const label = theme === "light" ? "Light" : theme === "dark" ? "Dusk" : "Auto";
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <button
      onClick={cycle}
      title={`Theme: ${label}. Click to cycle.`}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-subtle transition-colors hover:bg-muted hover:text-fg"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

function PaletteToggle() {
  const { palette, next } = usePalette();
  const cur = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];
  return (
    <button
      onClick={next}
      title={`Palette: ${cur.label}. Click for the next one (or choose in Settings).`}
      aria-label={`Palette ${cur.label}. Change palette`}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-subtle transition-colors hover:bg-muted hover:text-fg"
    >
      <span className="flex -space-x-1">
        {cur.swatch.slice(0, 3).map((c) => <span key={c} className="h-3.5 w-3.5 rounded-full ring-2 ring-surface" style={{ background: c }} />)}
      </span>
    </button>
  );
}

type NavItem = { href: string; label: string; Icon: typeof Sun };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Daily",
    items: [
      { href: "/today", label: "Today", Icon: Sun },
      { href: "/assistant", label: "Assistant", Icon: Bot },
      { href: "/plan", label: "Plan", Icon: ClipboardList },
      { href: "/tasks", label: "All tasks", Icon: ListChecks },
      { href: "/unfinished", label: "Unfinished", Icon: History },
      { href: "/diary", label: "Diary", Icon: BookOpen },
      { href: "/scratch", label: "Scratchpad", Icon: PenLine },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/sales", label: "Moves", Icon: Briefcase },
      { href: "/sales/pipeline", label: "Pipeline", Icon: KanbanSquare },
      { href: "/sales/radar", label: "Radar", Icon: Radar },
      { href: "/sales/accounts", label: "Accounts", Icon: Building2 },
    ],
  },
  {
    label: "Progress",
    items: [
      { href: "/review", label: "Review", Icon: CalendarCheck },
      { href: "/stats", label: "Stats", Icon: BarChart3 },
      { href: "/goals", label: "Goals", Icon: Target },
      { href: "/health", label: "Health", Icon: HeartPulse },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/projects", label: "Projects", Icon: FolderOpen },
      { href: "/contacts", label: "Contacts", Icon: Users },
      { href: "/refs", label: "References", Icon: BookMarked },
      { href: "/history", label: "History", Icon: Undo2 },
    ],
  },
];

// Phone bottom bar: the four daily destinations, plus "More" so every page stays reachable.
const MOBILE_MAIN: NavItem[] = [
  { href: "/today", label: "Today", Icon: Sun },
  { href: "/plan", label: "Plan", Icon: ClipboardList },
  { href: "/sales", label: "Sales", Icon: Briefcase },
  { href: "/stats", label: "Stats", Icon: BarChart3 },
];
const MOBILE_MORE: NavItem[] = [
  { href: "/sales/pipeline", label: "Pipeline", Icon: KanbanSquare },
  { href: "/sales/radar", label: "Radar", Icon: Radar },
  { href: "/diary", label: "Diary", Icon: BookOpen },
  { href: "/tasks", label: "All tasks", Icon: ListChecks },
  { href: "/history", label: "History", Icon: Undo2 },
  { href: "/assistant", label: "Assistant", Icon: Bot },
  { href: "/scratch", label: "Scratchpad", Icon: PenLine },
  { href: "/unfinished", label: "Unfinished", Icon: History },
  { href: "/review", label: "Review", Icon: CalendarCheck },
  { href: "/goals", label: "Goals", Icon: Target },
  { href: "/health", label: "Health", Icon: HeartPulse },
  { href: "/projects", label: "Projects", Icon: FolderOpen },
  { href: "/contacts", label: "Contacts", Icon: Users },
  { href: "/refs", label: "References", Icon: BookMarked },
  { href: "/settings", label: "Settings", Icon: Settings },
];

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const { href, label, Icon } = item;
  const hue = HUE[hueForPath(href)];
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-full px-2 py-1.5 text-sm font-medium transition-colors",
        active ? cn(hue.pill, hue.ink, "font-semibold shadow-[var(--shadow-sm)]") : "text-subtle hover:bg-muted hover:text-fg",
      )}
    >
      {active ? <span className={cn("absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full", hue.fill)} aria-hidden /> : null}
      {/* every page keeps its own colour, lit or not, so the sidebar doubles as a legend */}
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", hue.tint, hue.ink, active && "bg-surface/70")}>
        <Icon className={cn("h-[17px] w-[17px]", active && "stroke-[2.3]")} />
      </span>
      {label}
    </Link>
  );
}

export function AppShell({
  tz,
  boundaryMin,
  voiceEnabled,
  aiEnabled,
  undo,
  children,
}: {
  tz: string;
  boundaryMin: number;
  voiceEnabled: boolean;
  aiEnabled: boolean;
  undo: RecentAction | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/sales"
      ? pathname === "/sales" || /^\/sales\/(deal|docs|review|settings|clip)(\/|$)/.test(pathname)
      : pathname === href || pathname.startsWith(`${href}/`);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MOBILE_MORE.some((i) => active(i.href));
  useEffect(() => setMoreOpen(false), [pathname]);
  const { palette } = usePalette();
  // "candy" paints each page in its own pastel; any other palette paints every page the same
  const hue: Hue = palette === "candy" ? hueForPath(pathname) : palette;

  return (
    <ToastProvider>
      <UndoWatcher action={undo} />
      <div data-hue={hue} className="relative min-h-dvh w-full text-fg">
      <div className="canvas fixed inset-0 -z-10" aria-hidden />
      <StaleBanner />
      <div className="flex min-h-dvh w-full">
        {/* desktop sidebar */}
        <aside className="sticky top-3 m-3 hidden h-[calc(100dvh-1.5rem)] w-56 shrink-0 flex-col rounded-[1.75rem] border border-border bg-surface/75 px-3 py-5 shadow-[var(--shadow-md)] backdrop-blur-xl md:flex">
          <Link href="/today" className="flex items-center gap-2.5 px-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,hsl(var(--lilac-fill)),hsl(var(--sky-fill)))] text-p-lilac-fg shadow-[var(--shadow-sm)]">
              <BookOpen className="h-[18px] w-[18px]" />
            </span>
            <span className="font-display text-xl">Daybook</span>
          </Link>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("daybook:palette"))}
            className="mt-5 flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-sm text-subtle transition-colors hover:text-fg"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded border border-border px-1.5 text-[10px] font-medium">Ctrl K</kbd>
          </button>
          <nav className="mt-5 flex flex-1 flex-col gap-5 overflow-y-auto" aria-label="Main">
            {NAV_GROUPS.map((g) => (
              <div key={g.label}>
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle/70">{g.label}</p>
                <div className="flex flex-col gap-0.5">
                  {g.items.map((item) => <SideLink key={item.href} item={item} active={active(item.href)} />)}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-border pt-3">
            <SideLink item={{ href: "/settings", label: "Settings", Icon: Settings }} active={active("/settings")} />
            <div className="mt-1 flex items-center justify-between px-1"><PaletteToggle /><ThemeToggle /></div>
          </div>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className="pt-safe sticky top-0 z-30 border-b border-border bg-surface/70 backdrop-blur-xl md:border-0 md:bg-transparent md:backdrop-blur-0">
            <div className="flex items-center justify-between px-4 py-2 md:hidden">
              <Link href="/today" className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[linear-gradient(135deg,hsl(var(--lilac-fill)),hsl(var(--sky-fill)))] text-p-lilac-fg">
                  <BookOpen className="h-4 w-4" />
                </span>
                <span className="font-display text-lg">Daybook</span>
              </Link>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Search"
                  onClick={() => window.dispatchEvent(new CustomEvent("daybook:palette"))}
                  className="rounded-lg p-2 text-subtle hover:bg-muted hover:text-fg"
                >
                  <Search className="h-4 w-4" />
                </button>
                <PaletteToggle />
                <ThemeToggle />
              </div>
            </div>
            <div className="px-4 pb-3 pt-1 md:px-6 md:pt-5 xl:px-8">
              <Suspense fallback={<div className="h-[52px] rounded-full border border-border bg-surface" />}>
                <QuickAdd tz={tz} boundaryMin={boundaryMin} voiceEnabled={voiceEnabled} aiEnabled={aiEnabled} />
              </Suspense>
            </div>
          </header>

          <main className="w-full flex-1 px-4 pb-28 pt-2 md:px-6 md:pb-12 xl:px-8">{children}</main>
        </div>
      </div>

      {/* mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed inset-x-3 bottom-[calc(0.6rem+env(safe-area-inset-bottom))] z-30 grid grid-cols-5 rounded-[1.75rem] border border-border bg-surface/90 px-1 shadow-[var(--shadow-lg)] backdrop-blur-xl md:hidden"
      >
        {MOBILE_MAIN.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active(href) ? HUE[hueForPath(href)].ink : "text-subtle")}
          >
            <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active(href) && HUE[hueForPath(href)].tint)}>
              <Icon className={cn("h-5 w-5", active(href) && "stroke-[2.4]")} />
            </span>
            {label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", moreActive ? "text-accent" : "text-subtle")}
        >
          <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", moreActive && "bg-accent-muted")}>
            <LayoutGrid className="h-5 w-5" />
          </span>
          More
        </button>
      </nav>

      </div>

      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-black/40 md:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="sheet-content pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-border bg-surface p-4 shadow-[var(--shadow-lg)] md:hidden"
          >
            <div className="mb-3 flex items-center justify-between">
              <Dialog.Title className="font-display text-lg">More</Dialog.Title>
              <Dialog.Close className="rounded-full p-2 text-subtle hover:bg-muted" aria-label="Close">
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>
            <div className="grid grid-cols-3 gap-2 pb-2">
              {MOBILE_MORE.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-4 text-xs font-medium transition-colors",
                    active(href) ? cn("border-transparent", HUE[hueForPath(href)].tint, HUE[hueForPath(href)].ink) : "border-border bg-bg text-fg hover:bg-muted",
                  )}
                >
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", HUE[hueForPath(href)].tint, HUE[hueForPath(href)].ink)}>
                    <Icon className="h-5 w-5" />
                  </span>
                  {label}
                </Link>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <CommandPalette />
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>
    </ToastProvider>
  );
}
