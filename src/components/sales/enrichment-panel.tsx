"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { enrichAction } from "@/app/sales-actions";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import type { Enrichment } from "@/lib/sales/enrich";
import { ago } from "./util";

export function EnrichmentPanel({ kind, id, data, groups, enrichedAt, title }: {
  kind: "company" | "person"; id: number; data: Enrichment; groups: { group: string; fields: [string, string][] }[]; enrichedAt: string | null; title: string;
}) {
  const [busy, start] = useTransition();
  const [showEmpty, setShowEmpty] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const filled = Object.values(data ?? {}).filter((f) => f?.v !== null && f?.v !== undefined && f?.v !== "").length;
  // research now runs in the background in stages: after starting it, refresh every few seconds until the profile changes
  const [waiting, setWaiting] = useState(false);
  const [startedWith] = useState(enrichedAt);
  useEffect(() => {
    if (!waiting) return;
    if (enrichedAt !== startedWith) {
      setWaiting(false);
      toast("Profile updated");
      return;
    }
    const t = setInterval(() => router.refresh(), 6000);
    const stop = setTimeout(() => setWaiting(false), 4 * 60_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [waiting, enrichedAt, startedWith, router, toast]);
  const run = () =>
    start(async () => {
      const r = await enrichAction(kind, id, true);
      if (!r.ok) return toast(r.error, "error");
      toast("Research started. It takes a couple of minutes and runs in the background.");
      setWaiting(true);
    });
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base">{title}</h3>
          <p className="text-xs text-subtle">{enrichedAt ? `${filled} facts · researched ${ago(enrichedAt)}` : "Not researched yet"} · public sources only; "est." means estimated</p>
        </div>
        <div className="flex gap-2">
          {filled ? <Button size="sm" variant="ghost" onClick={() => setShowEmpty((s) => !s)}>{showEmpty ? "Hide empty" : "Show empty"}</Button> : null}
          <Button size="sm" variant="outline" onClick={run} disabled={busy || waiting}>
            {busy || waiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {waiting ? "Researching…" : enrichedAt ? "Research again" : "Research now"}
          </Button>
        </div>
      </div>
      {filled ? (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => {
            const rows = g.fields.filter(([k]) => showEmpty || (data[k]?.v !== null && data[k]?.v !== undefined && data[k]?.v !== ""));
            if (!rows.length) return null;
            return (
              <div key={g.group}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">{g.group}</p>
                <dl className="divide-y divide-border rounded-xl border border-border">
                  {rows.map(([k, label]) => {
                    const f = data[k];
                    const v = f?.v;
                    const text = v === true ? "Yes" : v === false ? "No" : v === null || v === undefined ? "" : typeof v === "number" && Math.abs(v) >= 10000 ? v.toLocaleString("en-US") : typeof v === "object" ? JSON.stringify(v) : String(v);
                    return (
                      <div key={k} className="grid grid-cols-[38%_1fr] gap-2 px-2.5 py-1.5 text-xs">
                        <dt className="text-subtle">{label}</dt>
                        <dd className={cn("break-words", !text && "text-subtle/60")}>
                          {/^https?:\/\//.test(text) ? <a href={text} target="_blank" rel="noreferrer" className="text-accent hover:underline">{text.replace(/^https?:\/\/(www\.)?/, "").slice(0, 50)}</a> : text || "unknown"}
                          {f?.est ? <span className="ml-1 rounded bg-warn-muted px-1 text-[10px] text-warn">est.</span> : null}
                          {f?.conf && text ? <span className="ml-1 text-[10px] text-subtle">{f.conf}</span> : null}
                          {f?.src && text && /^https?:/.test(String(f.src)) ? <a href={String(f.src)} target="_blank" rel="noreferrer" className="ml-1 text-[10px] text-accent">src</a> : null}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-subtle">Research runs automatically for new leads. Tap Research now to do it immediately.</p>
      )}
    </section>
  );
}
