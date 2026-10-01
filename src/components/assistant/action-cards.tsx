"use client";

import { Check, Loader2, Undo2, Zap } from "lucide-react";
import { useState } from "react";
import { applyAssistantAction, undoAssistantAction } from "@/app/assistant-actions";
import { cn } from "@/lib/cn";
import type { ActionItem } from "@/lib/assistant/types";
import { useToast } from "../toast";

/** The changes an answer proposes. Nothing happens until a tap; applied ones can be undone. */
export function ActionCards({ items: initial, onChanged }: { items: ActionItem[]; onChanged?: () => void }) {
  const { toast } = useToast();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<Set<number>>(new Set());

  const set = (item: ActionItem) => setItems((cur) => cur.map((i) => (i.id === item.id ? item : i)));
  const mark = (id: number, on: boolean) =>
    setBusy((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const apply = async (it: ActionItem) => {
    mark(it.id, true);
    const r = await applyAssistantAction(it.id);
    mark(it.id, false);
    if (r.ok) set(r.item);
    else {
      set({ ...it, status: "failed", error: r.error });
      toast(r.error, "error");
    }
    return r.ok;
  };

  const undo = async (it: ActionItem) => {
    mark(it.id, true);
    const r = await undoAssistantAction(it.id);
    mark(it.id, false);
    if (r.ok) {
      set(r.item);
      toast("Undone.");
      onChanged?.();
    } else toast(r.error, "error");
  };

  const pending = items.filter((i) => i.status === "proposed" || i.status === "failed");

  return (
    <div className="overflow-hidden rounded-2xl border border-accent/30 bg-accent-muted/30">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <Zap className="h-3.5 w-3.5 text-accent" />
        <p className="flex-1 text-xs font-semibold uppercase tracking-wide text-accent">
          {items.length === 1 ? "Suggested change" : `${items.length} suggested changes`}
        </p>
        {pending.length > 1 ? (
          <button
            className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg disabled:opacity-50"
            disabled={busy.size > 0}
            onClick={async () => {
              let n = 0;
              for (const it of pending) if (await apply(it)) n++;
              if (n) {
                toast(`${n} ${n === 1 ? "change" : "changes"} applied.`);
                onChanged?.();
              }
            }}
          >
            Apply all
          </button>
        ) : null}
      </div>
      <ul className="divide-y divide-border/60">
        {items.map((it) => {
          const working = busy.has(it.id);
          // deletes look different, so they are never tapped by accident
          const danger = it.label.startsWith("🗑");
          return (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2">
              <div className={cn("min-w-0 flex-1", it.status === "undone" && "opacity-50")}>
                <p className={cn("text-sm font-medium", it.status === "undone" && "line-through")}>{it.label}</p>
                {it.detail || it.error ? (
                  <p className={cn("line-clamp-2 text-xs", it.status === "failed" ? "text-bad" : "text-subtle")}>{it.status === "failed" ? it.error : it.detail}</p>
                ) : null}
              </div>
              {it.status === "applied" ? (
                <div className="flex shrink-0 items-center gap-1">
                  <span className="flex items-center gap-1 text-xs font-medium text-good"><Check className="h-3.5 w-3.5" /> Applied</span>
                  <button
                    className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-subtle hover:bg-surface hover:text-fg disabled:opacity-50"
                    onClick={() => undo(it)}
                    disabled={working}
                    title="Put things back the way they were"
                  >
                    {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Undo
                  </button>
                </div>
              ) : (
                <button
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-semibold disabled:opacity-50",
                    it.status === "undone" ? "border border-border bg-surface text-fg" : danger ? "bg-bad text-white" : "bg-accent text-accent-fg",
                  )}
                  disabled={working}
                  onClick={async () => {
                    if (await apply(it)) {
                      toast("Applied.");
                      onChanged?.();
                    }
                  }}
                >
                  {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {it.status === "failed" ? "Retry" : it.status === "undone" ? "Apply again" : danger ? "Delete" : "Apply"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
