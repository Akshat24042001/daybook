/**
 * Moves: the action list. Rules, not AI, decide what needs doing (so it is instant and free); AI only writes the draft.
 *
 * Every rule produces a move with a dedupe key. Refreshing upserts the moves that still apply and retires automatic
 * moves whose reason went away (they replied, the quote was accepted, the promise was kept). Score ranks the list:
 * kind urgency + deal size + how overdue + how hot.
 */
import { one, q } from "../db";
import { salesConfig, type SalesConfig } from "./config";
import { dealContext } from "./context";
import { refreshHeat, type DealCard, DEAL_CARD_SQL } from "./deals";
import { applyEvent } from "./stages";
import { draftMessage } from "./voice";

export type MoveKind =
  | "reply" | "follow_up" | "breakup" | "reengage" | "commit_mine" | "commit_theirs" | "stale" | "quote_hot" | "quote_unseen"
  | "quote_silent" | "payment_due" | "referral_ask" | "resurrect" | "next_action" | "radar" | "debrief" | "first_touch" | "custom";

const BASE: Record<MoveKind, number> = {
  quote_hot: 95, reply: 90, commit_mine: 82, payment_due: 78, debrief: 75, next_action: 70, first_touch: 62, commit_theirs: 62,
  quote_silent: 60, quote_unseen: 58, follow_up: 55, breakup: 52, reengage: 50, radar: 50, stale: 42, resurrect: 38, referral_ask: 34, custom: 60,
};

export const KIND_LABEL: Record<MoveKind, string> = {
  reply: "Reply", follow_up: "Follow up", breakup: "Last follow-up", reengage: "Re-engage", commit_mine: "Your promise",
  commit_theirs: "Their promise", stale: "Stuck", quote_hot: "Hot: quote being read", quote_unseen: "Quote not opened",
  quote_silent: "Quote read, no reply", payment_due: "Payment", referral_ask: "Ask for referral", resurrect: "Revisit",
  next_action: "Next step", radar: "New lead", debrief: "Debrief", first_touch: "First touch", custom: "To do",
};

interface Desired {
  deal_id: number | null;
  radar_item_id?: number | null;
  kind: MoveKind;
  title: string;
  why: string;
  channel: string | null;
  due_at: Date;
  key: string;
  value_usd?: number | null;
  heat?: number;
}

const H = 3_600_000;
const D = 86_400_000;
const t = (x: unknown) => (x ? new Date(x as string).getTime() : 0);

function score(d: Desired, now: number): number {
  const overdueH = Math.max(0, (now - d.due_at.getTime()) / H);
  const value = d.value_usd ? Math.min(18, Math.log10(d.value_usd + 1) * 4) : 0;
  return Math.round(BASE[d.kind] + value + Math.min(15, overdueH / 6) + (d.heat ?? 0) / 10);
}

function who(d: DealCard): string {
  return d.person_name ? `${d.person_name}${d.company_name ? ` (${d.company_name})` : ""}` : d.company_name ?? d.title;
}

/** The channel to use next: where they last replied, else where you last wrote. */
async function bestChannel(dealId: number): Promise<string | null> {
  const r = await one<{ channel: string }>(
    `select channel from sales_interactions where deal_id = $1 and channel in ('whatsapp','email','linkedin','instagram','sms','twitter','call')
     order by (direction in ('in','both')) desc, occurred_at desc limit 1`,
    [dealId],
  );
  return r?.channel ?? null;
}

async function desiredForDeal(cfg: SalesConfig, d: DealCard, now: number): Promise<Desired[]> {
  const out: Desired[] = [];
  const base = { deal_id: d.id, value_usd: d.value_usd, heat: d.heat };
  const lastIn = t(d.last_inbound_at);
  const lastOut = t(d.last_outbound_at);
  const role = d.stage_role;
  const open = d.stage_category === "open";
  const channel = await bestChannel(d.id);
  const name = who(d);

  // 1. they wrote last: reply
  if (lastIn && lastIn > lastOut && (open || d.stage_category === "won" || role === "nurture" || role === "ghosted")) {
    out.push({ ...base, kind: "reply", title: `Reply to ${name}`, why: `They wrote ${ago(now - lastIn)} and you have not replied.`, channel, due_at: new Date(lastIn + cfg.reply_within_hours * H), key: `reply:${d.id}:${lastIn}` });
  }

  // 2. new and never contacted: first touch
  if (role === "new" && !lastOut && !lastIn) {
    out.push({ ...base, kind: "first_touch", title: `First message to ${name}`, why: d.source === "radar" ? "Fresh lead from the radar. Speed wins." : "New lead, not contacted yet.", channel, due_at: new Date(t(d.created_at) + 4 * H), key: `first:${d.id}` });
  }

  // 3. follow-up sequence after first touch with no reply at all
  if (role === "contacted" && lastOut && !lastIn && !d.sequence_paused) {
    const firstOut = t((await one<{ m: string }>("select min(occurred_at) as m from sales_interactions where deal_id = $1 and direction in ('out','both')", [d.id]))?.m) || lastOut;
    const outs = (await one<{ n: number }>("select count(*)::int as n from sales_interactions where deal_id = $1 and direction in ('out','both')", [d.id]))?.n ?? 1;
    const step = Math.max(0, outs - 1); // follow-ups already sent
    const days = cfg.followup_days;
    if (step < days.length) {
      const last = step === days.length - 1;
      out.push({
        ...base, kind: last ? "breakup" : "follow_up",
        title: last ? `Last follow-up to ${name}` : `Follow-up ${step + 1} to ${name}`,
        why: last ? "No reply to the sequence. Short, honest, door left open." : `No reply since your first message ${ago(now - firstOut)}. Add something new, do not "just check in".`,
        channel, due_at: new Date(firstOut + days[step] * D), key: `fu:${d.id}:${step}`,
      });
    } else if (now - firstOut > cfg.ghost_after_days * D) {
      await applyEvent(d.id, "sequence_exhausted");
      await q("update sales_deals set revisit_on = (current_date + $2::int) where id = $1 and revisit_on is null", [d.id, cfg.ghost_revisit_days]);
    }
  }

  // 4. warm conversation went quiet: the ball is in their court for too long
  if (open && role !== "new" && role !== "contacted" && lastOut > lastIn && lastIn && now - lastOut > cfg.reengage_days * D) {
    out.push({ ...base, kind: "reengage", title: `Re-engage ${name}`, why: `Quiet for ${ago(now - lastOut)} after your last message. Bring something new.`, channel, due_at: new Date(lastOut + cfg.reengage_days * D), key: `re:${d.id}:${lastOut}` });
  }

  // 5. stuck in a stage longer than its limit
  if (open && d.stage_sla && now - t(d.stage_changed_at) > d.stage_sla * D && role !== "contacted") {
    out.push({ ...base, kind: "stale", title: `${d.title} is stuck in ${d.stage_name}`, why: `${Math.floor((now - t(d.stage_changed_at)) / D)} days in ${d.stage_name} (limit ${d.stage_sla}). Push it, park it, or close it.`, channel, due_at: new Date(t(d.stage_changed_at) + d.stage_sla * D), key: `sla:${d.id}:${t(d.stage_changed_at)}` });
  }

  // 6. your own next step with a date
  if (d.next_action && d.next_action_at && open) {
    out.push({ ...base, kind: "next_action", title: d.next_action, why: `Next step you set for ${d.title}.`, channel, due_at: new Date(d.next_action_at), key: `na:${d.id}:${t(d.next_action_at)}` });
  }

  // 7. parked deals come back on their date
  if ((role === "nurture" || role === "ghosted" || role === "hold" || (d.stage_category === "lost" && d.revisit_on)) && d.revisit_on) {
    const at = t(`${String(d.revisit_on).slice(0, 10)}T04:00:00Z`);
    if (at - now < 2 * D) out.push({ ...base, kind: "resurrect", title: `Revisit ${name}`, why: `${d.stage_name}${d.lost_reason ? ` (${d.lost_reason})` : ""}. The date you set has come. Open with something new.`, channel, due_at: new Date(at), key: `res:${d.id}:${String(d.revisit_on).slice(0, 10)}` });
  }

  // 8. referral ask three weeks after delivery or full payment
  if (role === "delivered" || role === "paid") {
    const since = t(d.stage_changed_at);
    const asked = await one("select 1 from sales_moves where deal_id = $1 and kind = 'referral_ask' and status in ('done','skipped')", [d.id]);
    if (!asked && now - since > 21 * D) out.push({ ...base, kind: "referral_ask", title: `Ask ${name} for a referral and a testimonial`, why: "Happy clients are the cheapest pipeline you have.", channel, due_at: new Date(since + 21 * D), key: `ref:${d.id}` });
  }
  return out;
}

function ago(ms: number): string {
  const h = Math.round(ms / H);
  if (h < 1) return "just now";
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)} days ago`;
}

async function desiredGlobal(cfg: SalesConfig, now: number): Promise<Desired[]> {
  const out: Desired[] = [];
  // promises
  const commits = await q<{ id: number; deal_id: number | null; owner: string; text: string; due_at: string | null; created_at: string; title: string | null; value_usd: number | null; heat: number | null }>(
    `select c.id, c.deal_id, c.owner, c.text, c.due_at, c.created_at, d.title, d.value_usd, d.heat
     from sales_commitments c left join sales_deals d on d.id = c.deal_id where c.status = 'open'`,
  );
  for (const c of commits) {
    if (c.owner === "me") {
      const due = c.due_at ? t(c.due_at) : t(c.created_at) + 2 * D;
      out.push({ deal_id: c.deal_id, kind: "commit_mine", title: c.text, why: `You promised this${c.title ? ` to ${c.title}` : ""}${c.due_at ? ` by ${new Date(due).toISOString().slice(0, 10)}` : ""}.`, channel: null, due_at: new Date(due - 6 * H), key: `cm:${c.id}`, value_usd: c.value_usd, heat: c.heat ?? 0 });
    } else if (c.due_at && t(c.due_at) < now + D) {
      out.push({ deal_id: c.deal_id, kind: "commit_theirs", title: `Nudge: they said "${c.text.slice(0, 80)}"`, why: `They promised this by ${new Date(t(c.due_at)).toISOString().slice(0, 10)}. A friendly nudge the day after.`, channel: null, due_at: new Date(t(c.due_at) + D), key: `ct:${c.id}`, value_usd: c.value_usd, heat: c.heat ?? 0 });
    }
  }
  // quotes
  const docs = await q<{ id: number; deal_id: number; title: string; sent_at: string; view_count: number; last_viewed_at: string | null; status: string; current_rev: number; last_in: string | null; recent_views: number; value_usd: number | null; heat: number }>(
    `select x.id, x.deal_id, x.title, x.sent_at, x.view_count, x.last_viewed_at, x.status, x.current_rev, d.last_inbound_at as last_in, d.value_usd, d.heat,
       (select count(*)::int from sales_doc_views v where v.doc_id = x.id and v.viewed_at > now() - interval '24 hours') as recent_views
     from sales_docs x join sales_deals d on d.id = x.deal_id join sales_stages s on s.id = d.stage_id
     where x.sent_at is not null and x.status in ('sent','viewed','changes') and s.category = 'open'`,
  );
  for (const x of docs) {
    const sent = t(x.sent_at);
    const repliedAfter = x.last_in && t(x.last_in) > sent;
    if (x.recent_views >= 3 && !repliedAfter) {
      out.push({ deal_id: x.deal_id, kind: "quote_hot", title: `Call now: "${x.title}" opened ${x.recent_views} times today`, why: "They are reading it right now. This is the moment to talk.", channel: "call", due_at: new Date(now), key: `qhot:${x.id}:${new Date(now).toISOString().slice(0, 10)}`, value_usd: x.value_usd, heat: x.heat });
    } else if (!x.view_count && now - sent > 2 * D) {
      out.push({ deal_id: x.deal_id, kind: "quote_unseen", title: `"${x.title}" not opened in 2 days`, why: "Check they got it, on a different channel.", channel: null, due_at: new Date(sent + 2 * D), key: `qun:${x.id}:${x.current_rev}`, value_usd: x.value_usd, heat: x.heat });
    } else if (x.view_count && !repliedAfter && x.last_viewed_at && now - t(x.last_viewed_at) > 2 * D) {
      out.push({ deal_id: x.deal_id, kind: "quote_silent", title: `"${x.title}" read ${x.view_count}x, no reply`, why: "They read it and went quiet. Ask one question about scope or timing.", channel: null, due_at: new Date(t(x.last_viewed_at) + 2 * D), key: `qss:${x.id}:${x.current_rev}`, value_usd: x.value_usd, heat: x.heat });
    }
  }
  // money
  const pays = await q<{ id: number; deal_id: number; label: string; amount: number; currency: string; due_on: string; title: string; heat: number }>(
    `select p.id, p.deal_id, p.label, p.amount, p.currency, p.due_on, d.title, d.heat from sales_payments p join sales_deals d on d.id = p.deal_id
     where p.status = 'due' and p.due_on is not null and p.due_on <= current_date + 1`,
  );
  for (const p of pays) {
    const due = t(`${String(p.due_on).slice(0, 10)}T04:30:00Z`);
    out.push({ deal_id: p.deal_id, kind: "payment_due", title: `Collect ${p.currency} ${Number(p.amount).toLocaleString("en-IN")} from ${p.title} (${p.label})`, why: due < now - D ? `Overdue since ${String(p.due_on).slice(0, 10)}. Cash is not won until it is paid.` : "Due now.", channel: null, due_at: new Date(due), key: `pay:${p.id}`, value_usd: null, heat: p.heat });
  }
  // debrief: a meeting ended and nothing was captured after it
  const meets = await q<{ id: number; deal_id: number | null; title: string; ends_at: string }>(
    `select m.id, m.deal_id, m.title, m.ends_at from sales_meetings m
     where not m.cancelled and m.deal_id is not null and m.ends_at between now() - interval '3 days' and now()
       and not exists (select 1 from sales_interactions i where i.deal_id = m.deal_id and i.created_at > m.ends_at - interval '10 minutes' and i.channel in ('meeting','note','call','in_person'))`,
  );
  for (const m of meets) out.push({ deal_id: m.deal_id, kind: "debrief", title: `Debrief: ${m.title}`, why: "30 seconds while it is fresh: send a voice note in Telegram, or paste the notes.", channel: null, due_at: new Date(t(m.ends_at) + 10 * 60_000), key: `deb:${m.id}` });
  // radar
  const radar = await q<{ id: number; title: string; score: number; found_at: string; source: string | null }>(
    `select r.id, r.title, r.score, r.found_at, s.name as source from sales_radar_items r left join sales_radar_sources s on s.id = r.source_id
     where r.status = 'qualified' and not r.hidden and r.deal_id is null and r.found_at > now() - interval '5 days'`,
  );
  for (const r of radar) out.push({ deal_id: null, radar_item_id: r.id, kind: "radar", title: r.title.slice(0, 140), why: `Radar ${r.score}/100${r.source ? ` from ${r.source}` : ""}. Reply fast or skip.`, channel: null, due_at: new Date(t(r.found_at)), key: `radar:${r.id}`, heat: r.score });
  void cfg;
  return out;
}

/** Recomputes the automatic moves (all deals, or one). Cheap: SQL and rules only. */
export async function refreshMoves(dealId?: number): Promise<{ open: number }> {
  const cfg = await salesConfig();
  const now = Date.now();
  await refreshHeat(dealId);
  const deals = await q<DealCard>(
    `${DEAL_CARD_SQL} where ($1::int is null or d.id = $1) and (s.category in ('open','won') or d.revisit_on is not null)`,
    [dealId ?? null],
  );
  const desired: Desired[] = [];
  for (const d of deals) desired.push(...(await desiredForDeal(cfg, d, now)));
  const global = await desiredGlobal(cfg, now);
  desired.push(...(dealId ? global.filter((g) => g.deal_id === dealId) : global));

  const valid = desired.filter((d) => Number.isFinite(d.due_at.getTime()));
  if (valid.length < desired.length) console.warn("[sales] moves with a bad date skipped:", desired.filter((d) => !valid.includes(d)).map((d) => d.key).join(", "));
  const keys = valid.map((d) => d.key);
  for (const d of valid) {
    await q(
      `insert into sales_moves (deal_id, radar_item_id, kind, title, why, channel, due_at, score, dedupe_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (dedupe_key) do update set title = excluded.title, why = excluded.why, score = excluded.score,
         channel = coalesce(sales_moves.channel, excluded.channel),
         status = case when sales_moves.status = 'obsolete' then 'open' else sales_moves.status end`,
      [d.deal_id, d.radar_item_id ?? null, d.kind, d.title.slice(0, 300), d.why, d.channel, d.due_at, score(d, now), d.key],
    );
  }
  // automatic moves whose reason is gone
  await q(
    `update sales_moves set status = 'obsolete' where created_by = 'auto' and status in ('open','snoozed') and not (dedupe_key = any($1))
       and ($2::int is null or deal_id = $2)`,
    [keys, dealId ?? null],
  );
  // snoozes that ran out
  await q("update sales_moves set status = 'open', snoozed_until = null where status = 'snoozed' and snoozed_until <= now()");
  const n = await one<{ n: number }>("select count(*)::int as n from sales_moves where status = 'open' and due_at <= now() + interval '1 day'");
  return { open: n?.n ?? 0 };
}

export interface MoveRow {
  id: number;
  deal_id: number | null;
  radar_item_id: number | null;
  kind: MoveKind;
  title: string;
  why: string | null;
  channel: string | null;
  draft: string | null;
  draft_subject: string | null;
  due_at: string;
  score: number;
  status: string;
  created_by: string;
  deal_title: string | null;
  person_name: string | null;
  company_name: string | null;
  stage_name: string | null;
  person_id: number | null;
  phones: string[] | null;
  emails: string[] | null;
  linkedin: string | null;
  instagram: string | null;
  radar_url: string | null;
}

export async function listMoves(o: { horizonHours?: number; dealId?: number; limit?: number } = {}): Promise<MoveRow[]> {
  return q<MoveRow>(
    `select m.*, d.title as deal_title, p.full_name as person_name, c.name as company_name, s.name as stage_name,
            p.id as person_id, p.phones, p.emails, p.linkedin, p.instagram, r.url as radar_url
     from sales_moves m
     left join sales_deals d on d.id = m.deal_id
     left join sales_stages s on s.id = d.stage_id
     left join sales_people p on p.id = case when d.talk_via_intermediary and d.intermediary_id is not null then d.intermediary_id else d.person_id end
     left join sales_companies c on c.id = d.company_id
     left join sales_radar_items r on r.id = m.radar_item_id
     where m.status = 'open' and ($1::int is null or m.deal_id = $1) and m.due_at <= now() + ($2 || ' hours')::interval
     order by (m.due_at <= now()) desc, m.score desc, m.due_at
     limit $3`,
    [o.dealId ?? null, String(o.horizonHours ?? 24), o.limit ?? 200],
  );
}

export async function getMove(id: number): Promise<MoveRow | null> {
  return (await q<MoveRow>(
    `select m.*, d.title as deal_title, p.full_name as person_name, c.name as company_name, s.name as stage_name,
            p.id as person_id, p.phones, p.emails, p.linkedin, p.instagram, r.url as radar_url
     from sales_moves m left join sales_deals d on d.id = m.deal_id left join sales_stages s on s.id = d.stage_id
     left join sales_people p on p.id = case when d.talk_via_intermediary and d.intermediary_id is not null then d.intermediary_id else d.person_id end
     left join sales_companies c on c.id = d.company_id left join sales_radar_items r on r.id = m.radar_item_id
     where m.id = $1`,
    [id],
  ))[0] ?? null;
}

export async function setMoveStatus(id: number, status: "done" | "skipped" | "open"): Promise<void> {
  await q("update sales_moves set status = $2, done_at = case when $2 = 'open' then null else now() end where id = $1", [id, status]);
  const m = await one<{ dedupe_key: string | null }>("select dedupe_key from sales_moves where id = $1", [id]);
  const ck = m?.dedupe_key?.match(/^c[mt]:(\d+)$/);
  if (ck && status === "done" && m!.dedupe_key!.startsWith("cm:")) await q("update sales_commitments set status = 'done', done_at = now() where id = $1", [Number(ck[1])]);
}

export async function snoozeMove(id: number, hours: number): Promise<void> {
  await q("update sales_moves set status = 'snoozed', snoozed_until = now() + ($2 || ' hours')::interval where id = $1", [id, String(hours)]);
}

export async function addCustomMove(o: { deal_id: number | null; title: string; due_at?: string | null }): Promise<number> {
  const row = await one<{ id: number }>(
    "insert into sales_moves (deal_id, kind, title, due_at, created_by, score) values ($1,'custom',$2,coalesce($3::timestamptz, now()),'me',60) returning id",
    [o.deal_id, o.title, o.due_at ?? null],
  );
  return row!.id;
}

const PURPOSE: Partial<Record<MoveKind, string>> = {
  reply: "Reply to their latest message. Answer what they asked, move it one step forward.",
  first_touch: "First message. Zero pitch. One genuine specific observation and one easy question.",
  follow_up: "Follow-up after no reply. One new angle or a small piece of value, then an easy question. Never 'just checking in'.",
  breakup: "Breakup message: last follow-up, 1 to 2 sentences, honest, door left open.",
  reengage: "Re-engage a warm conversation that went quiet with something genuinely new tied to what they said.",
  commit_mine: "Deliver or update on what I promised them.",
  commit_theirs: "Friendly nudge about what they said they would do, make it easy for them.",
  quote_hot: "Talking points for a call right now while they are reading the quote: confirm scope, handle the likely objection, ask for the decision.",
  quote_unseen: "Short check that they received the proposal link, on a different channel.",
  quote_silent: "They read the proposal and went quiet. Ask one question about scope, timing or budget fit.",
  payment_due: "Polite, firm payment reminder with the amount and what it is for. No apology.",
  referral_ask: "Ask a happy client for one referral and a two-line testimonial. Make it easy.",
  resurrect: "Reopen a parked deal with something new (a result, an idea, a timing check). No guilt trip.",
  next_action: "Do the next step that was planned.",
  radar: "Reply to this posted requirement or signal. Specific to what they asked, show you understood, one easy next step.",
  debrief: "Recap email after the meeting: what we discussed, what each side will do, next date.",
  custom: "Do what the move says.",
  stale: "Move a stuck deal forward with one clear question.",
};

/** Writes (or rewrites) the draft for a move, in the owner's voice. */
export async function draftForMove(id: number, channelOverride?: string): Promise<MoveRow | null> {
  const m = await getMove(id);
  if (!m) return null;
  const channel = channelOverride ?? m.channel ?? (m.phones?.length ? "whatsapp" : m.emails?.length ? "email" : m.linkedin ? "linkedin" : "whatsapp");
  let context = "";
  let toCountry: string | null = null;
  if (m.deal_id) {
    context = await dealContext(m.deal_id);
    toCountry = (await one<{ country: string | null }>("select country from sales_deals where id = $1", [m.deal_id]))?.country ?? null;
  } else if (m.radar_item_id) {
    const r = await one<{ title: string; body: string | null; url: string | null; angle: string | null; fit: { country?: string } | null }>("select title, body, url, angle, fit from sales_radar_items where id = $1", [m.radar_item_id]);
    context = `POST: ${r?.title}\n${(r?.body ?? "").slice(0, 3000)}\nURL: ${r?.url ?? ""}\nANGLE: ${r?.angle ?? ""}`;
    toCountry = r?.fit?.country ?? null;
  }
  const step = m.kind === "follow_up" ? m.title.match(/Follow-up (\d+)/)?.[1] : null;
  const draft = await draftMessage({
    channel,
    purpose: `${PURPOSE[m.kind] ?? "Move the deal forward."}\nMOVE: ${m.title}\nWHY: ${m.why ?? ""}`,
    step: step ? `follow-up ${step}` : m.kind,
    context,
    toName: m.person_name,
    toCountry,
  });
  await q("update sales_moves set draft = $2, draft_subject = $3, channel = $4 where id = $1", [id, draft.message, draft.subject, channel]);
  return getMove(id);
}
