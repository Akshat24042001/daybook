"use client";
// Trips on the radar: the trip badge on a lead, booking a meeting with it, and the trip's day-by-day plan.
import { ArrowUpRight, CalendarCheck, CalendarDays, Check, Loader2, MapPin, RefreshCw, Star, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bookLeadMeetingAction, cancelLeadMeetingAction, findTripEventsAction, tripEventStatusAction } from "@/app/sales-actions";
import { Button, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { addDays, fmtRange, weekdayName, fmtDateShort, diffDays, type DateStr } from "@/lib/time";
import type { TripEvent, TripMeeting } from "@/lib/sales/targets";

export interface LeadTrip { city: string; from: DateStr; to: DateStr }

/** "Udaipur trip · in 15 days (29 Nov to 2 Dec)". Pure. */
export function tripLabel(t: LeadTrip, today: DateStr, o: { short?: boolean } = {}): string {
  const when = today > t.to ? "over" : today >= t.from ? "you are there now" : diffDays(t.from, today) === 1 ? "tomorrow" : `in ${diffDays(t.from, today)} days`;
  if (o.short) return `${when[0].toUpperCase()}${when.slice(1)} · ${fmtRange(t.from, t.to)} · ${t.city}`;
  return `${t.city} trip · ${when} (${fmtRange(t.from, t.to)})`;
}

export function TripBadge({ trip, today }: { trip: LeadTrip; today: DateStr }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-p-butter px-1.5 py-0.5 font-semibold text-p-butter-fg" suppressHydrationWarning>
      <MapPin className="h-3 w-3" />{tripLabel(trip, today)}
    </span>
  );
}

/** Book a meeting with this lead: it becomes a deal (if not yet) and the meeting lands on the trip plan. */
export function BookMeeting({ itemId, trip, today, booked }: { itemId: number; trip: LeadTrip | null; today: DateStr; booked: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, start] = useTransition();
  const first = trip ? (trip.from > today ? trip.from : today <= trip.to ? today : addDays(today, 1)) : addDays(today, 1);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string>(first);
  const [time, setTime] = useState("11:00");
  const [place, setPlace] = useState(trip?.city ?? "");
  if (booked && !open) {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-xl bg-p-mint px-3 py-2 text-xs text-p-mint-fg">
        <CalendarCheck className="h-4 w-4" /> Meeting booked: <b>{weekdayName(booked.slice(0, 10))} {fmtDateShort(booked.slice(0, 10))}, {booked.slice(11, 16)}</b>
        <button type="button" className="underline" onClick={() => setOpen(true)}>Change</button>
      </p>
    );
  }
  if (!open) {
    return (
      <Button size="sm" variant={trip ? "primary" : "outline"} onClick={() => setOpen(true)}>
        <CalendarCheck className="h-3.5 w-3.5" /> {trip ? `Book a meeting in ${trip.city}` : "Book a meeting"}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-accent/30 bg-accent-muted/30 p-2.5 text-xs" aria-label="Book a meeting">
      <label className="grid gap-0.5">Day
        <Input type="date" value={date} min={trip && trip.from > today ? trip.from : today} max={trip?.to} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" />
      </label>
      <label className="grid gap-0.5">Time<Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 w-28 text-xs" /></label>
      <label className="grid min-w-[140px] flex-1 gap-0.5">Where<Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Their office, a cafe, a call" className="h-8 text-xs" /></label>
      <Button size="sm" variant="primary" disabled={busy || !date} onClick={() => start(async () => {
        const r = await bookLeadMeetingAction(itemId, date, time, place);
        if (!r.ok) return toast(r.error, "error");
        toast("Meeting booked. The lead is now a deal, and the meeting is on the trip plan.");
        setOpen(false);
        router.refresh();
      })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarCheck className="h-3.5 w-3.5" />} Book it</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {trip ? <p className="w-full text-subtle">You are in {trip.city} {fmtRange(trip.from, trip.to)}.</p> : null}
    </div>
  );
}

/** The trip's days with the meetings booked on each, so gaps are easy to see and fill. */
export function TripPlan({ from, to, meetings, tz, events = [] }: { from: DateStr; to: DateStr; meetings: TripMeeting[]; tz: string; events?: TripEvent[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  // events you are going to just before or after the trip stretch the plan to cover them
  const going = events.filter((e) => e.status === "going" && e.starts_on);
  const first = [from, ...going.map((e) => e.starts_on!)].sort()[0];
  const last = [to, ...going.map((e) => e.ends_on ?? e.starts_on!)].sort().at(-1)!;
  const days: DateStr[] = [];
  for (let d = first; d <= last && days.length < 21; d = addDays(d, 1)) days.push(d);
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  return (
    <ol className="mt-2 space-y-1.5 text-xs" aria-label="Trip plan">
      {days.map((d) => {
        const list = meetings.filter((m) => dayOf(m.starts_at) === d);
        const evs = going.filter((e) => e.starts_on! <= d && (e.ends_on ?? e.starts_on!) >= d);
        const away = d < from || d > to;
        const what = [list.length ? `${list.length} meeting${list.length === 1 ? "" : "s"}` : "", evs.length ? `${evs.length} event${evs.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ") || "free";
        return (
          <li key={d} className={cn("rounded-lg px-2 py-1.5", list.length || evs.length ? "bg-p-mint/60" : "bg-muted", away && "border border-dashed border-border")}>
            <p className="font-semibold">{weekdayName(d)} {fmtDateShort(d)} <span className="font-normal text-subtle">· {what}{away ? " · outside the trip: stay longer?" : ""}</span></p>
            {evs.map((e) => (
              <p key={`e${e.id}`} className="mt-0.5 flex items-center gap-1.5"><CalendarDays className="h-3 w-3 text-accent" /><a href={e.url} target="_blank" rel="noreferrer" className="underline">{e.title}</a>{e.time_text ? <span className="text-subtle">{e.time_text}</span> : null}</p>
            ))}
            {list.map((m) => (
              <p key={m.id} className="mt-0.5 flex items-center gap-1.5" suppressHydrationWarning>
                <b className="tabular">{timeOf(m.starts_at)}</b>
                {m.deal_id ? <a href={`/sales/deal/${m.deal_id}`} className="underline">{m.title}</a> : m.title}
                <button type="button" aria-label={`Cancel ${m.title}`} className="ml-auto rounded p-0.5 text-subtle hover:bg-surface" disabled={busy} onClick={() => {
                  if (confirm(`Cancel "${m.title}"?`)) start(async () => { await cancelLeadMeetingAction(m.id); router.refresh(); });
                }}><X className="h-3 w-3" /></button>
              </p>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

const KIND_LABEL: Record<string, string> = { community: "Your community", business: "Business meet", startup: "Startup", tech: "Tech", industry: "Industry", talk: "Talk", expo: "Expo" };

/** Events around the trip: your communities first, each with where it came from, and whether to go. */
export function TripEvents({ huntId, events, from, to, checkedAt }: { huntId: number; events: TripEvent[]; from: DateStr; to: DateStr; checkedAt: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, start] = useTransition();
  const [showSkipped, setShowSkipped] = useState(false);
  const list = events.filter((e) => showSkipped || e.status !== "skipped");
  const skipped = events.filter((e) => e.status === "skipped").length;
  const set = (id: number, status: "new" | "going" | "skipped") => start(async () => {
    const r = await tripEventStatusAction(id, status);
    if (!r.ok) toast(r.error, "error");
    router.refresh();
  });
  const when = (e: TripEvent) => {
    if (!e.starts_on) return "Date not shown: open the page";
    const d = `${weekdayName(e.starts_on)} ${fmtDateShort(e.starts_on)}${e.ends_on && e.ends_on !== e.starts_on ? ` to ${fmtDateShort(e.ends_on)}` : ""}`;
    const rel = e.starts_on < from ? ` (${diffDays(from, e.starts_on)} day${diffDays(from, e.starts_on) === 1 ? "" : "s"} before you arrive)` : e.starts_on > to ? ` (${diffDays(e.starts_on, to)} day${diffDays(e.starts_on, to) === 1 ? "" : "s"} after you leave)` : " (during your trip)";
    return `${d}${rel}`;
  };
  return (
    <section className="mt-3 rounded-xl border border-border p-3" aria-label="Events around your trip">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-accent" /> Events around your trip <span className="font-normal text-subtle">· {fmtRange(addDays(from, -5), addDays(to, 5))}</span></p>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => {
          const r = await findTripEventsAction(huntId);
          toast(r.ok ? "Looking for events. They appear here within a few minutes, and on Telegram." : r.error, r.ok ? "ok" : "error");
          router.refresh();
        })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Look again</Button>
      </div>
      {list.length === 0 ? (
        <p className="mt-1 text-xs text-subtle">{checkedAt ? "Nothing found yet in or near the city for these dates. It looks again every day until the trip." : "Looking for your community's events, business meets, talks and conferences in and near the city. It checks every day until the trip."}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {list.map((e) => (
            <li key={e.id} className={cn("rounded-lg border p-2.5 text-xs", e.community ? "border-p-butter-fg/30 bg-p-butter/40" : "border-border", e.status === "going" && "border-good/40 bg-p-mint/40", e.status === "skipped" && "opacity-60")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("rounded px-1.5 py-0.5 font-semibold", e.community ? "bg-p-butter text-p-butter-fg" : "bg-muted text-subtle")}>{e.community ? <><Star className="mr-0.5 inline h-3 w-3" />{e.community}</> : KIND_LABEL[e.kind] ?? e.kind}</span>
                    <span className={cn("font-semibold", !e.starts_on && "text-subtle")}>{when(e)}</span>
                    {e.starts_on && !e.date_confirmed ? <span className="rounded bg-p-rose px-1.5 py-0.5 text-p-rose-fg">check the date</span> : null}
                  </p>
                  <a href={e.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold hover:underline">{e.title}<ArrowUpRight className="h-3.5 w-3.5" /></a>
                  <p className="text-subtle">{[e.time_text, e.venue, e.city, e.organizer ? `by ${e.organizer}` : null].filter(Boolean).join(" · ")}</p>
                  {e.why ? <p className="mt-0.5">{e.why}</p> : null}
                </div>
                <div className="flex gap-1">
                  {e.status === "going" ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => set(e.id!, "new")}><Check className="h-3.5 w-3.5 text-good" /> Going</Button>
                  ) : (
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => set(e.id!, "going")}><CalendarCheck className="h-3.5 w-3.5" /> I&apos;ll go</Button>
                  )}
                  {e.status === "skipped" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => set(e.id!, "new")}>Bring back</Button>
                    : <Button size="sm" variant="ghost" aria-label={`Skip ${e.title}`} disabled={busy} onClick={() => set(e.id!, "skipped")}><X className="h-3.5 w-3.5" /></Button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {skipped ? <button type="button" className="mt-2 text-xs text-subtle underline" onClick={() => setShowSkipped((x) => !x)}>{showSkipped ? "Hide skipped" : `Show ${skipped} skipped`}</button> : null}
      <p className="mt-2 text-[11px] text-subtle">Each event links to the page it was found on. Confirm the date and register there; &quot;check the date&quot; means the page did not show it clearly.</p>
    </section>
  );
}
