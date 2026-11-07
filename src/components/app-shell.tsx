"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  BarChart3, BookMarked, BookOpen, Bot, Briefcase, CalendarCheck, ClipboardList, FolderOpen, HeartPulse, KanbanSquare, LayoutGrid, Monitor, Moon, PenLine, Radar, Settings, Sun, Target,
  History, Search, Users, X, Building2, ListChecks, Undo2, CalendarDays, LogOut, LineChart, Library,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { HUE, hueForPath, type Hue } from "@/lib/hue";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import { CommandPalette } from "./command-palette";
import { Logo } from "./logo";
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

function ThemeToggle() {
  const { theme, cycle } = useTheme();
  const label = theme === "light" ? "Light" : theme === "dark" ? "Dark" : "Auto";
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <button
      onClick={cycle}
      title={`Theme: ${label}. Click to cycle.`}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-subtle transition-colors hover:bg-muted hover:text-fg"
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
      { href: "/calendar", label: "Calendar", Icon: CalendarDays },
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
      { href: "/sales/insights", label: "Insights", Icon: LineChart },
      { href: "/sales/playbook", label: "Playbook", Icon: Library },
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
  { href: "/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/sales/pipeline", label: "Pipeline", Icon: KanbanSquare },
  { href: "/sales/radar", label: "Radar", Icon: Radar },
  { href: "/sales/insights", label: "Insights", Icon: LineChart },
  { href: "/sales/playbook", label: "Playbook", Icon: Library },
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

/** A plain form post: it works without JavaScript and always lands on the login page. */
function SignOut({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <form action="/api/auth/logout" method="post">
      <button type="submit" className={className} title="Sign out of Daybook">
        <LogOut className="h-4 w-4" />
        {children}
      </button>
    </form>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const { href, label, Icon } = item;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium transition-colors",
        active ? "bg-muted text-fg" : "text-subtle hover:bg-muted/70 hover:text-fg",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "text-subtle/80")} strokeWidth={active ? 2.2 : 1.9} />
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
  const hue: Hue = hueForPath(pathname);

  return (
    <ToastProvider>
      <UndoWatcher action={undo} />
      <div data-hue={hue} className="relative min-h-dvh w-full text-fg">
      <div className="canvas fixed inset-0 -z-10" aria-hidden />
      <StaleBanner />
      <div className="flex min-h-dvh w-full">
        {/* desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 md:flex">
          <Link href="/today" className="flex items-center px-2" aria-label="Daybook, go to Today">
            <Logo size={28} />
          </Link>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("daybook:palette"))}
            className="mt-4 flex h-8 items-center gap-2 rounded-md border border-border bg-bg px-2.5 text-[13px] text-subtle transition-colors hover:text-fg"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded border border-border px-1.5 text-[10px] font-medium">Ctrl K</kbd>
          </button>
          <nav className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto" aria-label="Main">
            {NAV_GROUPS.map((g) => (
              <div key={g.label}>
                <p className="mb-1 px-2.5 text-xs font-medium text-subtle/80">{g.label}</p>
                <div className="flex flex-col gap-0.5">
                  {g.items.map((item) => <SideLink key={item.href} item={item} active={active(item.href)} />)}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-border pt-3">
            <SideLink item={{ href: "/settings", label: "Settings", Icon: Settings }} active={active("/settings")} />
            <div className="mt-1 flex items-center justify-between px-1"><ThemeToggle /></div>
            <SignOut className="mt-0.5 flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium text-subtle transition-colors hover:bg-muted/70 hover:text-fg">
              Sign out
            </SignOut>
          </div>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className="pt-safe sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur md:bg-bg/85">
            <div className="flex items-center justify-between px-4 py-2 md:hidden">
              <Link href="/today" className="flex items-center" aria-label="Daybook, go to Today">
                <Logo size={28} textClassName="text-base" />
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
            <div className="px-4 pb-3 pt-1 md:px-8 md:py-3">
              <Suspense fallback={<div className="h-11 rounded-lg border border-border bg-surface" />}>
                <QuickAdd tz={tz} boundaryMin={boundaryMin} voiceEnabled={voiceEnabled} aiEnabled={aiEnabled} />
              </Suspense>
            </div>
          </header>

          <main className="w-full flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-12 md:pt-6">{children}</main>
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
            className={cn("flex flex-col items-center gap-1 pb-1.5 pt-2 text-[11px] font-medium", active(href) ? "text-accent" : "text-subtle")}
          >
            <Icon className="h-5 w-5" strokeWidth={active(href) ? 2.2 : 1.8} />
            {label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          className={cn("flex flex-col items-center gap-1 pb-1.5 pt-2 text-[11px] font-medium", moreActive ? "text-accent" : "text-subtle")}
        >
          <LayoutGrid className="h-5 w-5" strokeWidth={moreActive ? 2.2 : 1.8} />
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
                    "flex flex-col items-center gap-2 rounded-lg border px-2 py-3.5 text-xs font-medium transition-colors",
                    active(href) ? "border-accent/40 bg-accent-muted text-accent" : "border-border bg-surface text-fg hover:bg-muted",
                  )}
                >
                  <Icon className={cn("h-5 w-5", active(href) ? "text-accent" : "text-subtle")} strokeWidth={1.9} />
                  {label}
                </Link>
              ))}
            </div>
            <SignOut className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-3 text-sm font-medium text-subtle hover:bg-muted hover:text-fg">
              Sign out
            </SignOut>
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
