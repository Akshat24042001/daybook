"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isStaleClientError, reloadOnce } from "@/lib/stale-client";
import { Button } from "./ui";

/** What a page shows instead of crashing: a plain message, Try again, and Reload. */
export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [stale] = useState(() => isStaleClientError(error));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    console.error("[daybook] page error:", error);
    // a new version was deployed while this tab was open: the fix is a fresh load, so do it for you
    if (stale) reloadOnce();
  }, [error, stale]);
  const retry = () => {
    setBusy(true);
    router.refresh();
    reset();
    setTimeout(() => setBusy(false), 1500);
  };
  return (
    <div role="alert" className="mx-auto mt-10 max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-[var(--shadow-sm)]">
      <h2 className="font-display text-lg">{stale ? "Daybook was updated" : "This page hit a snag"}</h2>
      <p className="mt-2 text-sm text-subtle">
        {stale
          ? "A newer version is live. Reloading brings it in. Nothing you saved is lost."
          : "Nothing you saved is lost. It is usually a slow connection to the database; trying again almost always works."}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        {!stale && (
          <Button variant="primary" onClick={retry} disabled={busy}>
            {busy ? "Trying…" : "Try again"}
          </Button>
        )}
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
      {error.digest && <p className="mt-3 text-xs text-subtle">Reference: {error.digest}</p>}
    </div>
  );
}
