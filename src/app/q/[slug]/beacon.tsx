"use client";

import { useEffect } from "react";

/** Reports time on page when the client leaves or hides the tab. */
export function ViewBeacon({ v, k }: { v: number; k: string }) {
  useEffect(() => {
    const start = Date.now();
    let sent = 0;
    const send = () => {
      const s = Math.round((Date.now() - start) / 1000);
      if (s - sent < 3) return;
      sent = s;
      navigator.sendBeacon?.("/api/sales/view", JSON.stringify({ v, k, s }));
    };
    const onHide = () => document.visibilityState === "hidden" && send();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", send);
    const t = setInterval(send, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", send);
      clearInterval(t);
    };
  }, [v, k]);
  return null;
}
