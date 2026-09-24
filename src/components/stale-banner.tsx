"use client";

import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";

interface Health {
  stale: boolean;
  ageSec: number | null;
  lastTickAt: string | null;
}

const INITIAL: Health = { stale: false, ageSec: null, lastTickAt: null };

/**
 * Polls /api/health every 60s client-side. No server-side DB call needed —
 * the banner starts hidden and shows immediately if the poll finds staleness.
 */
export function StaleBanner() {
  const [h, setH] = useState<Health>(INITIAL);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem("daybook-stale-dismissed") === "1");
    } catch {
      /* storage blocked: keep showing */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const json = (await res.json()) as Health;
        if (alive) setH(json);
      } catch {
        if (alive) setH((cur) => ({ ...cur, stale: true }));
      }
    };
    void check(); // check immediately on mount
    const id = setInterval(check, 60_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!h.stale || dismissed) return null;
  const mins = h.ageSec === null ? null : Math.round(h.ageSec / 60);
  return (
    <div role="alert" className="flex items-start gap-2 border-b border-warn/30 bg-warn-muted px-4 py-2 text-xs text-warn md:text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">
        {mins === null
          ? "The scheduler has never run."
          : `The scheduler has not run for ${mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} minutes`}.`}{" "}
        Telegram reminders and the morning brief may not arrive. Check the Supabase Cron job.
      </p>
      <button
        type="button"
        aria-label="Hide for this session"
        className="-my-1 rounded-md p-1 hover:bg-warn/15"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem("daybook-stale-dismissed", "1");
          } catch {
            /* ignore */
          }
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
