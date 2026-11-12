"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { ToastProvider } from "@/components/toast";

/** Calls the team API. Never server actions: the team area cannot reach the owner's actions at all. */
export async function teamCall<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<{ ok: true } & T | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/team/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) {
      window.location.href = "/team/login";
      return { ok: false, error: "Please sign in again." };
    }
    return (await res.json()) as { ok: true } & T;
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection." };
  }
}

export function TeamShell({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="min-h-dvh bg-bg">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/team" className="font-display text-base font-semibold">Aivaura Sales</Link>
            <nav className="flex items-center gap-3 text-sm">
              <Link href="/team" className="text-subtle hover:text-fg">My leads</Link>
              <Link href="/team/new" className="text-subtle hover:text-fg">New lead</Link>
              <span className="hidden text-subtle sm:inline">· {name}</span>
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/team/logout", { method: "POST" });
                  window.location.href = "/team/login";
                }}
                className="inline-flex items-center gap-1 text-subtle hover:text-fg"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
      </div>
    </ToastProvider>
  );
}

