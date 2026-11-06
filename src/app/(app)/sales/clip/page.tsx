"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { clipAction, undoCaptureAction } from "@/app/sales-actions";
import { Button } from "@/components/ui";
import type { CaptureResult } from "@/lib/sales/ingest";

/** Landing page for the bookmarklet: the page text arrives in the URL hash and is filed into Sales. */
export default function ClipPage() {
  const [state, setState] = useState<"reading" | "done" | "error" | "empty">("reading");
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [error, setError] = useState("");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    let data: { text?: string; url?: string; title?: string } = {};
    try {
      data = JSON.parse(decodeURIComponent(window.location.hash.slice(1)));
    } catch {
      setState("empty");
      return;
    }
    history.replaceState(null, "", "/sales/clip");
    void clipAction(data.text ?? "", data.url ?? "", data.title ?? "").then((r) => {
      if (!r.ok) {
        setError(r.error);
        setState("error");
      } else {
        setResult(r.result);
        setState("done");
      }
    });
  }, []);
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-border bg-surface p-5">
      {state === "reading" ? <p className="text-sm">Reading the page and filing it into Sales…</p> : null}
      {state === "empty" ? <p className="text-sm text-subtle">Use the Daybook bookmarklet on a LinkedIn chat, a profile, or any page. Set it up in Sales, Settings.</p> : null}
      {state === "error" ? <p className="text-sm text-bad">{error}</p> : null}
      {state === "done" && result ? (
        <div className="space-y-2 text-sm">
          <p className="font-semibold">{result.skipped ?? (result.created_deal ? "New lead created" : result.deal_id ? "Logged" : "Could not tell who this is about")}</p>
          {result.summary ? <p className="text-subtle">{result.summary}</p> : null}
          {result.next_step ? <p>Next: {result.next_step}</p> : null}
          <div className="flex gap-2 pt-2">
            {result.deal_id ? (
              <Link href={`/sales/deal/${result.deal_id}`}>
                <Button variant="primary" size="sm">Open deal</Button>
              </Link>
            ) : null}
            {result.capture_id ? (
              <Button size="sm" variant="ghost" onClick={() => void undoCaptureAction(result.capture_id!).then(() => setState("empty"))}>
                Undo
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => window.close()}>
              Close tab
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
