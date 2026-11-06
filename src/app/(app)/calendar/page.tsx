import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar/calendar-view";
import { makeCtx } from "@/lib/settings";
import { CAL_VIEWS, type CalView } from "@/lib/calendar-range";
import { calendarData } from "@/lib/services/calendar";
import { parseDateStr } from "@/lib/time";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const sp = await searchParams;
  const ctx = await makeCtx();
  const view = (CAL_VIEWS as string[]).includes(sp.view ?? "") ? (sp.view as CalView) : "month";
  const ok = sp.date && DATE.test(sp.date) && !Number.isNaN(parseDateStr(sp.date).y);
  const data = await calendarData(ctx, view, ok ? sp.date! : ctx.today);
  return <CalendarView data={data} />;
}
