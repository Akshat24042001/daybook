"use client";

import { useEffect } from "react";
import { isStaleClientError, reloadOnce } from "@/lib/stale-client";

export function ServiceWorkerRegister() {
  useEffect(() => {
    // After a deploy, a tab still running the old build can fail to load code or call a renamed server action.
    // Those failures do not always reach an error screen, so catch them here and reload into the new build.
    const onError = (e: ErrorEvent) => {
      if (isStaleClientError(e.error ?? e.message)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isStaleClientError(e.reason)) reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // updateViaCache "none": always fetch sw.js fresh, so a fixed worker reaches phones on the next visit
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
    }
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
