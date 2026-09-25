/**
 * Keep in touch: each contact has an interval (default 30 days, null = never nudge). The last touch is the latest
 * logged call / meeting / message, or when the contact was added. Anyone past their interval is due; the most
 * overdue come first. Snoozing hides someone until a date.
 */
import { getPool, one, q, UserError, type Db } from "../db";
import { addDays, calendarDate, diffDays, type DateStr } from "../time";

export type TouchKind = "call" | "meet" | "message" | "other";
export const TOUCH_KINDS: TouchKind[] = ["call", "meet", "message", "other"];
export const TOUCH_INTERVALS = [7, 14, 30, 60, 90] as const;

export interface TouchState {
  contactId: number;
  name: string;
  everyDays: number | null;
  lastTouch: DateStr | null;
  lastKind: TouchKind | null;
  /** days since the last touch (or since the contact was added) */
  sinceDays: number;
  /** positive = days past the interval */
  overdueDays: number | null;
  snoozedUntil: DateStr | null;
  due: boolean;
}

export interface Touch {
  id: number;
  contact_id: number;
  date: DateStr;
  kind: TouchKind;
  note: string | null;
}

let ensured: Promise<void> | null = null;
function ensureTables(db: Db = getPool()): Promise<void> {
  ensured ??= (async () => {
    await db.query(`
      alter table contacts add column if not exists touch_every_days int default 30
        check (touch_every_days is null or (touch_every_days between 1 and 365));
      alter table contacts add column if not exists touch_snoozed_until date;
      create table if not exists contact_touches (
        id serial primary key,
        contact_id int not null references contacts(id) on delete cascade,
        date date not null,
        kind text not null default 'other' check (kind in ('call','meet','message','other')),
        note text,
        created_at timestamptz not null default now()
      );
      create index if not exists contact_touches_contact_idx on contact_touches (contact_id, date desc);`);
  })().catch((e) => {
    ensured = null;
    throw e;
  });
  return ensured;
}

/** Touch state for every contact, most overdue first. `tz` turns created_at into a local date. */
export async function touchStates(today: DateStr, tz: string): Promise<TouchState[]> {
  await ensureTables();
  const rows = await q<{
    id: number; name: string; touch_every_days: number | null; touch_snoozed_until: DateStr | null;
    created_at: Date; last_date: DateStr | null; last_kind: TouchKind | null;
  }>(
    `select c.id, c.name, c.touch_every_days, c.touch_snoozed_until, c.created_at, t.date as last_date, t.kind as last_kind
     from contacts c
     left join lateral (
       select date, kind from contact_touches where contact_id = c.id order by date desc, id desc limit 1
     ) t on true`,
  );
  const out = rows.map((r): TouchState => {
    const base = r.last_date ?? calendarDate(r.created_at, tz);
    const sinceDays = Math.max(0, diffDays(today, base));
    const overdueDays = r.touch_every_days === null ? null : sinceDays - r.touch_every_days;
    const snoozed = !!r.touch_snoozed_until && r.touch_snoozed_until > today;
    return {
      contactId: r.id,
      name: r.name,
      everyDays: r.touch_every_days,
      lastTouch: r.last_date,
      lastKind: r.last_kind,
      sinceDays,
      overdueDays,
      snoozedUntil: snoozed ? r.touch_snoozed_until : null,
      due: overdueDays !== null && overdueDays >= 0 && !snoozed,
    };
  });
  return out.sort((a, b) => Number(b.due) - Number(a.due) || (b.overdueDays ?? -1e9) - (a.overdueDays ?? -1e9));
}

export async function logTouch(contactId: number, date: DateStr, kind: TouchKind, note?: string | null): Promise<void> {
  await ensureTables();
  if (!TOUCH_KINDS.includes(kind)) throw new UserError("Pick call, meet, message or other.");
  const c = await one("select 1 from contacts where id = $1", [contactId]);
  if (!c) throw new UserError("That contact no longer exists.");
  await q("insert into contact_touches (contact_id, date, kind, note) values ($1, $2, $3, $4)", [
    contactId, date, kind, note?.trim() ? note.trim().slice(0, 500) : null,
  ]);
  // a touch ends any snooze
  await q("update contacts set touch_snoozed_until = null where id = $1", [contactId]);
}

export async function setTouchInterval(contactId: number, days: number | null): Promise<void> {
  await ensureTables();
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new UserError("Pick between 1 and 365 days.");
  await q("update contacts set touch_every_days = $2 where id = $1", [contactId, days]);
}

export async function snoozeTouch(contactId: number, today: DateStr, days = 7): Promise<DateStr> {
  await ensureTables();
  const until = addDays(today, days);
  await q("update contacts set touch_snoozed_until = $2 where id = $1", [contactId, until]);
  return until;
}

export async function recentTouches(contactId: number, limit = 10): Promise<Touch[]> {
  await ensureTables();
  return q<Touch>("select id, contact_id, date, kind, note from contact_touches where contact_id = $1 order by date desc, id desc limit $2", [contactId, limit]);
}

export async function deleteTouch(id: number): Promise<void> {
  await ensureTables();
  await q("delete from contact_touches where id = $1", [id]);
}
