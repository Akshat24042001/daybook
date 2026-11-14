"use client";
// Trips on the radar: the trip badge on a lead, booking a meeting with it, and the trip's day-by-day plan.
import { CalendarCheck, Loader2, MapPin, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bookLeadMeetingAction, cancelLeadMeetingAction } from "@/app/sales-actions";
import { Button, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { addDays, fmtRange, weekdayName, fmtDateShort, diffDays, type DateStr } from "@/lib/time";
import type { TripMeeting } from "@/lib/sales/targets";

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
export function TripPlan({ from, to, meetings, tz }: { from: DateStr; to: DateStr; meetings: TripMeeting[]; tz: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const days: DateStr[] = [];
  for (let d = from; d <= to && days.length < 21; d = addDays(d, 1)) days.push(d);
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  return (
    <ol className="mt-2 space-y-1.5 text-xs" aria-label="Trip plan">
      {days.map((d) => {
        const list = meetings.filter((m) => dayOf(m.starts_at) === d);
        return (
          <li key={d} className={cn("rounded-lg px-2 py-1.5", list.length ? "bg-p-mint/60" : "bg-muted")}>
            <p className="font-semibold">{weekdayName(d)} {fmtDateShort(d)} <span className="font-normal text-subtle">· {list.length ? `${list.length} meeting${list.length === 1 ? "" : "s"}` : "free"}</span></p>
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
