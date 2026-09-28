"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveScratchAction } from "@/app/scratch-actions";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Debounced save of one scratchpad item. `queue(patch)` merges into the pending change and saves after `delay` ms
 * of quiet; pending changes are flushed when the card unmounts or the tab hides, so nothing typed is lost.
 */
export function useAutosave(id: number, delay = 700) {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ title?: string; data?: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) await inflight.current; // keep saves in order
    const patch = pending.current;
    if (!patch) return;
    pending.current = null;
    setState("saving");
    const p = (async () => {
      const r = await saveScratchAction(id, patch).catch(() => ({ ok: false as const, error: "Offline? Not saved yet." }));
      if (r.ok) {
        setState(pending.current ? "saving" : "saved");
        setError(null);
      } else {
        // put it back so the next edit or a retry sends it again
        pending.current = { ...patch, ...pending.current };
        setState("error");
        setError(r.error);
      }
    })();
    inflight.current = p;
    await p;
    inflight.current = null;
  }, [id]);

  const queue = useCallback(
    (patch: { title?: string; data?: unknown }) => {
      pending.current = { ...pending.current, ...patch };
      setState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  return { queue, flush, state, error };
}
