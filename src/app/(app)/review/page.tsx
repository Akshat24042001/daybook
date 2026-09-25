import type { Metadata } from "next";
import { ReviewView } from "@/components/review/review-view";
import { aiConfigured } from "@/lib/ai";
import { makeCtx } from "@/lib/settings";
import { getReview, periodBounds, periodLabel, reviewData, shiftPeriod, type ReviewPeriod } from "@/lib/services/review";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await makeCtx();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const period: ReviewPeriod = one(sp.p) === "month" ? "month" : "week";
  const at = one(sp.d);
  const anchor = at && DATE.test(at) && at <= ctx.today ? at : ctx.today;
  const { start } = periodBounds(period, anchor);
  const current = periodBounds(period, ctx.today).start;
  const next = shiftPeriod(period, start, 1);
  const prev = shiftPeriod(period, start, -1);

  const [data, nextRow, prevRow] = await Promise.all([
    reviewData(ctx, period, start),
    getReview(period, next),
    // on the running period, point at last period's review while it is fresh
    start === current ? getReview(period, prev) : Promise.resolve(null),
  ]);

  return (
    <ReviewView
      data={JSON.parse(JSON.stringify(data))}
      label={periodLabel(period, start)}
      isCurrent={start === current}
      prevStart={prev}
      nextStart={next <= ctx.today ? next : null}
      nextLabel={periodLabel(period, next)}
      nextIntentions={nextRow?.intentions ?? []}
      lastReview={prevRow?.generated_at ? { start: prev, label: periodLabel(period, prev), headline: prevRow.headline ?? "", grade: prevRow.grade } : null}
      aiEnabled={aiConfigured()}
      today={ctx.today}
    />
  );
}
