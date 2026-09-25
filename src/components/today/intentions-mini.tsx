"use client";

import { Check, Compass } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { markIntentionAction } from "@/app/review-actions";
import { cn } from "@/lib/cn";
import type { Intention } from "@/lib/services/review";
import type { DateStr } from "@/lib/time";
import { useToast } from "../toast";
import { Card } from "../ui";

/** This week's intentions on Today: a daily reminder of what you said mattered, with a one-tap tick. */
export function IntentionsMini({ weekStart, items }: { weekStart: DateStr; items: Intention[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [, start] = useTransition();
  const [opt, setOpt] = useOptimistic(items);
  const done = opt.filter((i) => i.done === true).length;

  if (!items.length) {
    return (
      <Link
        href="/review"
        className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3 text-sm transition-colors hover:border-accent/50 hover:bg-accent-muted/30"
      >
        <Compass className="h-4 w-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Set this week&apos;s intentions</span>
          <span className="block text-xs text-subtle">Three things that would make the week a win.</span>
        </span>
      </Link>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <Compass className="h-4 w-4 text-accent" />
        <Link href="/review" className="text-sm font-semibold hover:underline">This week</Link>
        <span className="tabular ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-subtle">{done}/{opt.length}</span>
      </div>
      <ul className="space-y-2">
        {opt.map((it, i) => (
          <li key={i}>
            <button
              type="button"
              aria-pressed={it.done === true}
              onClick={() =>
                start(async () => {
                  const next = it.done === true ? null : true;
                  setOpt(opt.map((x, j) => (j === i ? { ...x, done: next } : x)));
                  const r = await markIntentionAction("week", weekStart, i, next);
                  if (!r.ok) toast(r.error, "error");
                  router.refresh();
                })
              }
              className="flex w-full items-start gap-2.5 text-left"
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                  it.done === true ? "border-good bg-good text-white" : "border-border hover:border-good",
                )}
              >
                {it.done === true ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <span className={cn("text-sm", it.done === true && "text-subtle line-through decoration-good/60")}>{it.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
