"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  BarChart3, BookMarked, BookOpen, CalendarCheck, ClipboardList, FolderOpen, HeartPulse, LayoutGrid, Monitor, Moon, Settings, Sun, Target,
  History, Search, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { CommandPalette } from "./command-palette";
import { NavProgress } from "./nav-progress";
import { QuickAdd } from "./quick-add";
import { StaleBanner } from "./stale-banner";
import { ToastProvider } from "./toast";

type Theme = "system" | "light" | "dark";

function useTheme() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const stored = (localStorage.getItem("daybook-theme") as Theme) ?? "system";
    setTheme(stored);
    document.documentElement.dataset.theme = stored === "system" ? "" : stored;
    // the "t" shortcut switches theme too: keep the label in sync
    const onTheme = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("daybook:theme", onTheme);
    return () => window.removeEventListener("daybook:theme", onTheme);
  }, []);
  const cycle = () => {
    const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    localStorage.setItem("daybook-theme", next);
    document.documentElement.dataset.theme = next === "system" ? "" : next;
  };
  return { theme, cycle };
}

function ThemeToggle() {
  const { theme, cycle } = useTheme();
  const label = theme === "light" ? "Light" : theme === "dark" ? "Dark" : "Auto";
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <button
      onClick={cycle}
      title={`Theme: ${label}. Click to cycle.`}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-subtle transition-colors hover:bg-muted hover:text-fg"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

type NavItem = { href: string; label: string; Icon: typeof Sun };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Daily",
    items: [
      { href: "/today", label: "Today", Icon: Sun },
      { href: "/plan", label: "Plan", Icon: ClipboardList },
      { href: "/unfinished", label: "Unfinished", Icon: History },
      { href: "/diary", label: "Diary", Icon: BookOpen },
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
    ],
  },
];

// Phone bottom bar: the four daily destinations, plus "More" so every page stays reachable.
const MOBILE_MAIN: NavItem[] = [
  { href: "/today", label: "Today", Icon: Sun },
  { href: "/plan", label: "Plan", Icon: ClipboardList },
  { href: "/diary", label: "Diary", Icon: BookOpen },
  { href: "/stats", label: "Stats", Icon: BarChart3 },
];
const MOBILE_MORE: NavItem[] = [
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
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-accent-muted text-accent" : "text-subtle hover:bg-muted hover:text-fg",
      )}
    >
      {active ? <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent" aria-hidden /> : null}
      <Icon className={cn("h-[18px] w-[18px]", active && "stroke-[2.3]")} />
      {label}
    </Link>
  );
}

export function AppShell({
  tz,
  boundaryMin,
  voiceEnabled,
  aiEnabled,
  children,
}: {
  tz: string;
  boundaryMin: number;
  voiceEnabled: boolean;
  aiEnabled: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MOBILE_MORE.some((i) => active(i.href));
  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <ToastProvider>
      <StaleBanner />
      <div className="flex min-h-dvh w-full">
        {/* desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-border bg-surface/60 px-3 py-5 md:flex">
          <Link href="/today" className="flex items-center gap-2.5 px-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-[0_2px_8px_hsl(var(--accent)/0.35)]">
              <BookOpen className="h-4 w-4" />
            </span>
            <span className="font-display text-xl">Daybook</span>
          </Link>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("daybook:palette"))}
            className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2 text-sm text-subtle transition-colors hover:border-accent/40 hover:text-fg"
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
          <div className="flex items-center justify-between border-t border-border pt-3">
            <SideLink item={{ href: "/settings", label: "Settings", Icon: Settings }} active={active("/settings")} />
            <ThemeToggle />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="pt-safe sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur md:border-0 md:bg-transparent md:backdrop-blur-0">
            <div className="flex items-center justify-between px-4 py-2 md:hidden">
              <Link href="/today" className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
                  <BookOpen className="h-3.5 w-3.5" />
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
                <ThemeToggle />
              </div>
            </div>
            <div className="px-4 pb-3 pt-1 md:px-6 md:pt-5 xl:px-8">
              <Suspense fallback={<div className="h-[52px] rounded-2xl border border-border bg-surface" />}>
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
        className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 backdrop-blur md:hidden"
      >
        {MOBILE_MAIN.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active(href) ? "text-accent" : "text-subtle")}
          >
            <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active(href) && "bg-accent-muted")}>
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
                    active(href) ? "border-accent/40 bg-accent-muted text-accent" : "border-border bg-bg text-fg hover:bg-muted",
                  )}
                >
                  <Icon className="h-5 w-5" />
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
