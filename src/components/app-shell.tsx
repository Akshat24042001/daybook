"use client";

import { BarChart3, ClipboardList, HeartPulse, Settings, Sun, Target } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/cn";
import { QuickAdd } from "./quick-add";
import { StaleBanner } from "./stale-banner";
import { ToastProvider } from "./toast";

const NAV = [
  { href: "/today", label: "Today", Icon: Sun },
  { href: "/plan", label: "Plan", Icon: ClipboardList },
  { href: "/goals", label: "Goals", Icon: Target },
  { href: "/health", label: "Health", Icon: HeartPulse },
  { href: "/stats", label: "Stats", Icon: BarChart3 },
] as const;

export function AppShell({
  tz,
  boundaryMin,
  voiceEnabled,
  health,
  children,
}: {
  tz: string;
  boundaryMin: number;
  voiceEnabled: boolean;
  health: { stale: boolean; ageSec: number | null; lastTickAt: string | null };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <ToastProvider>
      <StaleBanner initial={health} />
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl">
        {/* desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-border px-3 py-5 md:flex">
          <Link href="/today" className="font-display px-3 text-2xl">
            Daybook
          </Link>
          <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Main">
            {NAV.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active(href) ? "bg-accent text-accent-fg" : "text-subtle hover:bg-muted hover:text-fg",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {label}
              </Link>
            ))}
          </nav>
          <Link
            href="/settings"
            aria-current={active("/settings") ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
              active("/settings") ? "bg-accent text-accent-fg" : "text-subtle hover:bg-muted hover:text-fg",
            )}
          >
            <Settings className="h-[18px] w-[18px]" />
            Settings
          </Link>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="pt-safe sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur md:border-0 md:bg-transparent md:backdrop-blur-0">
            <div className="flex items-center justify-between px-4 py-2 md:hidden">
              <Link href="/today" className="font-display text-xl">
                Daybook
              </Link>
              <Link
                href="/settings"
                aria-label="Settings"
                className={cn("rounded-xl p-2 text-subtle hover:bg-muted hover:text-fg", active("/settings") && "bg-muted text-fg")}
              >
                <Settings className="h-5 w-5" />
              </Link>
            </div>
            <div className="px-4 pb-3 pt-1 md:px-6 md:pt-5">
              <Suspense fallback={<div className="h-[52px] rounded-2xl border border-border bg-surface" />}>
                <QuickAdd tz={tz} boundaryMin={boundaryMin} voiceEnabled={voiceEnabled} />
              </Suspense>
            </div>
          </header>

          <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-4 md:px-6 md:pb-12">{children}</main>
        </div>
      </div>

      {/* mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 backdrop-blur md:hidden"
      >
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
              active(href) ? "text-accent" : "text-subtle",
            )}
          >
            <Icon className={cn("h-5 w-5", active(href) && "stroke-[2.4]")} />
            {label}
          </Link>
        ))}
      </nav>
    </ToastProvider>
  );
}
