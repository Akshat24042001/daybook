"use client";

import { useEffect } from "react";
import { isStaleClientError, reloadOnce } from "@/lib/stale-client";

/** Last line of defence: an error in the root layout itself. Plain HTML, since the app's own styles may not be there. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[daybook] app error:", error);
    if (isStaleClientError(error)) reloadOnce();
  }, [error]);
  const btn = { padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", background: "#fff", font: "inherit", cursor: "pointer" } as const;
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#F6F7F9", color: "#1a1a1a" }}>
        <div style={{ textAlign: "center", maxWidth: 380, padding: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Something went wrong</h2>
          <p style={{ color: "#666", fontSize: 14 }}>Nothing you saved is lost. Try again, or reload the page.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button type="button" style={btn} onClick={() => reset()}>Try again</button>
            <button type="button" style={btn} onClick={() => window.location.reload()}>Reload page</button>
          </div>
          {error.digest && <p style={{ color: "#999", fontSize: 12 }}>Reference: {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
