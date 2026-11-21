/**
 * Sales changes the assistant can propose (web chat and Telegram alike). Like every assistant action: checked when
 * proposed, applied only when you tap it, and undoable. They apply through the same service functions as the deal
 * page, so the field history, stage journey and moves stay right.
 */
import { one, q, UserError } from "../db";
import { addCommitment, createDeal, logActivity, updateDeal } from "../sales/deals";
import { upsertPerson } from "../sales/identity";
import { refreshMoves } from "../sales/moves";
import { moveDeal } from "../sales/stages";
import { messageAt } from "../sales/ingest";
import { calendarDate } from "../time";
import type { Ctx } from "../settings";
import { dateArg, has, int, isClear, localTime, num, rowScope, s, strList, type Scope, type Snapshot } from "./action-kit";

export interface SalesDef {
  doc: string;
  prepare(ctx: Ctx, raw: Record<string, unknown>): Promise<{ params: Record<string, unknown>; label: string; detail: string | null }>;
  scopes(ctx: Ctx, p: Record<string, unknown>): Promise<Scope[]> | Scope[];
  run(ctx: Ctx, p: Record<string, unknown>, undo: Snapshot): Promise<string>;
}

async function dealOr(id: unknown): Promise<{ id: number; title: string; person_id: number | null; stage_id: number }> {
  const n = int(id);
  const d = n === null ? null : await one<{ id: number; title: string; person_id: number | null; stage_id: number }>("select id, title, person_id, stage_id from sales_deals where id = $1", [n]);
  if (!d) throw new UserError(`That lead does not exist (deal_id ${s(id, 12) || "missing"}). Find it in sales_deals by title, person or company.`);
  return d;
}

const isoDay = (v: unknown): string | null => {
  const t = s(v, 30);
  if (!t) return null;
  const m = /^\d{4}-\d{2}-\d{2}/.exec(t);
  if (!m || Number.isNaN(Date.parse(m[0]))) throw new UserError(`"${t}" is not a date. Use YYYY-MM-DD.`);
  return m[0];
};

/** "2 lakh", "1.5L", "50k", "2,00,000", "₹ 1 crore" -> a number. */
export function amountOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  const t = s(v, 60).toLowerCase().replace(/[₹$,\s]|rs\.?|inr|usd/g, "");
  const m = /^(\d+(?:\.\d+)?)(k|thousand|l|lakh|lakhs|lac|cr|crore|crores|m|mn|million)?$/.exec(t);
  if (!m) return null;
  const mult: Record<string, number> = { k: 1e3, thousand: 1e3, l: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, cr: 1e7, crore: 1e7, crores: 1e7, m: 1e6, mn: 1e6, million: 1e6 };
  return Math.round(Number(m[1]) * (m[2] ? mult[m[2]] : 1) * 100) / 100;
}

const TEXT_FIELDS: Record<string, string> = {
  title: "Deal name", next_action: "Next step", summary: "Where we are", requirements: "Requirements", budget: "Budget", timeline: "Timeline",
  notes: "Notes", pain: "Pain", desired_outcome: "Desired outcome", impact: "Impact", current_solution: "Current solution", compelling_event: "Why now",
  decision_criteria: "Decision criteria", decision_process: "Decision process", risks: "Risks", scope: "Scope", payment_terms: "Payment terms",
  country: "Country", city: "City", industry: "Industry", source_detail: "Source detail", lost_reason: "Lost reason",
};
const DATE_FIELDS: Record<string, string> = { expected_close: "Expected close", next_action_at: "Next step date", start_date: "Start date", delivery_date: "Delivery date", revisit_on: "Revisit on" };
const LIST_FIELDS: Record<string, string> = { services: "Services", tags: "Tags", competitors: "Competitors", objections: "Objections" };
/** friendly names the model may use */
const ALIAS: Record<string, string> = { next_step: "next_action", next_step_date: "next_action_at", next_step_at: "next_action_at", name: "title", close_date: "expected_close", win_chance: "probability", value_amount: "value" };

export const SALES_ACTIONS: Record<string, SalesDef> = {
  update_deal: {
    doc: `update_deal: deal_id + any of value ("2 lakh", 200000), currency (INR|USD|AED…), probability (0-100), ${Object.keys(TEXT_FIELDS).join(", ")}, ${Object.keys(DATE_FIELDS).join(", ")} (YYYY-MM-DD), ${Object.keys(LIST_FIELDS).join(", ")} (arrays; add:true appends): change a lead's details ("clear" empties a field)`,
    async prepare(_c, raw) {
      const d = await dealOr(raw.deal_id);
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) o[ALIAS[k] ?? k] = v;
      const patch: Record<string, unknown> = {};
      const said: string[] = [];
      if (has(o, "value")) {
        if (isClear(o.value)) { patch.value_amount = null; said.push("Value cleared"); }
        else {
          const n = amountOf(o.value);
          if (n === null) throw new UserError(`"${s(o.value, 30)}" is not an amount. Say 200000 or "2 lakh".`);
          patch.value_amount = n;
          said.push(`Value ${n.toLocaleString("en-IN")}`);
        }
      }
      if (has(o, "currency")) {
        const c = s(o.currency, 5).toUpperCase();
        if (!/^[A-Z]{3}$/.test(c)) throw new UserError("currency is a 3-letter code like INR or USD.");
        patch.currency = c;
        said.push(c);
      }
      if (has(o, "probability")) {
        const p = num(o.probability);
        if (p === null || p < 0 || p > 100) throw new UserError("probability is 0 to 100.");
        patch.probability = Math.round(p);
        said.push(`Win chance ${Math.round(p)}%`);
      }
      for (const [k, label] of Object.entries(TEXT_FIELDS)) {
        if (!has(o, k)) continue;
        const v = isClear(o[k]) ? null : s(o[k], k === "title" ? 200 : 4000) || null;
        if (k === "title" && !v) throw new UserError("A deal needs a name.");
        patch[k] = v;
        said.push(v ? `${label}: ${v.length > 50 ? `${v.slice(0, 49)}…` : v}` : `${label} cleared`);
      }
      for (const [k, label] of Object.entries(DATE_FIELDS)) {
        if (!has(o, k)) continue;
        const v = isClear(o[k]) ? null : isoDay(o[k]);
        patch[k] = v;
        said.push(v ? `${label} ${v}` : `${label} cleared`);
      }
      for (const [k, label] of Object.entries(LIST_FIELDS)) {
        if (!has(o, k)) continue;
        let list = isClear(o[k]) ? [] : strList(o[k], 30);
        if (o.add === true || o.add === "true") {
          const cur = (await one<Record<string, string[]>>(`select ${k} from sales_deals where id = $1`, [d.id]))?.[k] ?? [];
          list = [...new Set([...cur, ...list])];
        }
        patch[k] = list;
        said.push(`${label}: ${list.join(", ") || "none"}`);
      }
      if (!Object.keys(patch).length) throw new UserError("update_deal needs a field to change.");
      return { params: { deal_id: d.id, patch }, label: `✎ ${d.title}`, detail: said.join(" · ").slice(0, 280) };
    },
    scopes: (_c, p) => [rowScope("sales_deals", p.deal_id as number)],
    async run(_c, p) {
      await updateDeal(p.deal_id as number, p.patch as Record<string, unknown>, { cause: "ai" });
      await refreshMoves(p.deal_id as number).catch(() => {});
      return "Updated.";
    },
  },

  move_deal: {
    doc: "move_deal: deal_id, stage (stage name or role: contacted, engaged, discovery, proposal, negotiation, won, lost, nurture, parked…), reason (needed for lost/won), revisit_on (YYYY-MM-DD, for nurture/on hold), note: move a lead to another stage",
    async prepare(_c, o) {
      const d = await dealOr(o.deal_id);
      const want = s(o.stage, 60).toLowerCase();
      if (!want) throw new UserError("move_deal needs a stage.");
      const st = await one<{ id: number; name: string }>(
        "select id, name from sales_stages where active and (lower(name) = $1 or role = $1 or lower(key) = $1) order by (lower(name) = $1) desc limit 1",
        [want],
      ) ?? await one<{ id: number; name: string }>("select id, name from sales_stages where active and lower(name) like $1 order by sort limit 1", [`%${want}%`]);
      if (!st) throw new UserError(`There is no stage called "${s(o.stage, 40)}". Query sales_stages for the names.`);
      if (st.id === d.stage_id) throw new UserError(`${d.title} is already in ${st.name}.`);
      const reason = s(o.reason, 200) || null;
      const date = has(o, "revisit_on") ? isoDay(o.revisit_on) : null;
      return { params: { deal_id: d.id, stage_id: st.id, reason, date, note: s(o.note, 500) || null }, label: `→ ${d.title}: ${st.name}`, detail: [reason, date ? `revisit ${date}` : null].filter(Boolean).join(" · ") || null };
    },
    scopes: (_c, p) => [rowScope("sales_deals", p.deal_id as number)],
    async run(_c, p) {
      await moveDeal(p.deal_id as number, p.stage_id as number, { cause: "manual", reason: (p.reason as string) ?? null, date: (p.date as string) ?? null, note: (p.note as string) ?? "from the assistant" });
      await refreshMoves(p.deal_id as number).catch(() => {});
      return "Moved.";
    },
  },

  log_deal_note: {
    doc: "log_deal_note: deal_id, text, channel (note|call|meeting|whatsapp|email|linkedin|in_person|instagram; default note), direction (in|out|both), occurred_at (YYYY-MM-DD, or YYYY-MM-DD HH:MM on the owner's clock when the time is known; leave it out for just now): add something that happened to the lead's timeline",
    async prepare(_c, o) {
      const d = await dealOr(o.deal_id);
      const text = s(o.text ?? o.note ?? o.body, 4000);
      if (!text) throw new UserError("log_deal_note needs the text.");
      // "type" is the action's own name, so the kind of touch comes in "channel"
      const type = s(o.channel ?? o.kind, 20).toLowerCase() || "note";
      const direction = ["in", "out", "both"].includes(s(o.direction, 5)) ? s(o.direction, 5) : undefined;
      const at = has(o, "occurred_at") ? (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}$/.test(String(o.occurred_at).trim()) ? String(o.occurred_at).trim() : isoDay(o.occurred_at)) : null;
      return { params: { deal_id: d.id, person_id: d.person_id, text, type, direction, at }, label: `＋ ${type === "note" ? "Note" : type} on ${d.title}`, detail: text.slice(0, 200) };
    },
    scopes: () => [],
    async run(c, p, undo) {
      const id = await logActivity(p.deal_id as number, {
        type: p.type as string, direction: p.direction as never, body: p.text as string, subject: null, person_id: (p.person_id as number) ?? null,
        occurred_at: noteTime(p.at as string | null, c.tz, c.now),
      });
      undo.created.push({ table: "sales_interactions", id });
      await refreshMoves(p.deal_id as number).catch(() => {});
      return "Logged.";
    },
  },

  add_deal_promise: {
    doc: "add_deal_promise: deal_id, owner (me|them), text, due (YYYY-MM-DD): a promise you made or they made",
    async prepare(_c, o) {
      const d = await dealOr(o.deal_id);
      const owner = s(o.owner, 5) === "them" ? "them" : "me";
      const text = s(o.text, 500);
      if (!text) throw new UserError("add_deal_promise needs the text.");
      const due = has(o, "due") ? isoDay(o.due) : null;
      return { params: { deal_id: d.id, person_id: d.person_id, owner, text, due }, label: `${owner === "me" ? "📌 You promise" : "🤝 They promise"}: ${text.slice(0, 60)}`, detail: [d.title, due ? `due ${due}` : null].filter(Boolean).join(" · ") };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const id = await addCommitment({ deal_id: p.deal_id as number, person_id: (p.person_id as number) ?? null, owner: p.owner as "me" | "them", text: p.text as string, due_at: p.due ? `${p.due}T12:30:00.000Z` : null });
      if (id) undo.created.push({ table: "sales_commitments", id });
      await refreshMoves(p.deal_id as number).catch(() => {});
      return "Added.";
    },
  },

  update_lead_contact: {
    doc: "update_lead_contact: person_id (or deal_id for its main contact) + any of full_name, title, email (adds), phone (adds), whatsapp, linkedin, instagram, city, country, preferred_channel, language, department, seniority, is_decision_maker, notes",
    async prepare(_c, o) {
      let pid = int(o.person_id);
      if (pid === null && has(o, "deal_id")) pid = (await dealOr(o.deal_id)).person_id;
      const p = pid === null ? null : await one<{ id: number; full_name: string }>("select id, full_name from sales_people where id = $1", [pid]);
      if (!p) throw new UserError("That contact does not exist. Query sales_people (or the deal's person_id).");
      const set: Record<string, unknown> = {};
      const said: string[] = [];
      for (const k of ["full_name", "title", "whatsapp", "linkedin", "instagram", "city", "country", "preferred_channel", "language", "department", "seniority", "notes"]) {
        if (!has(o, k)) continue;
        const v = isClear(o[k]) ? null : s(o[k], k === "notes" ? 4000 : 300) || null;
        if (k === "full_name" && !v) throw new UserError("A contact needs a name.");
        set[k] = v;
        said.push(`${k.replace(/_/g, " ")}: ${v ?? "cleared"}`);
      }
      if (has(o, "is_decision_maker")) { set.is_decision_maker = o.is_decision_maker === true || o.is_decision_maker === "true"; said.push(set.is_decision_maker ? "decision maker" : "not the decision maker"); }
      const email = s(o.email, 200).toLowerCase();
      if (email) { if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new UserError(`"${email}" is not an email address.`); said.push(`email ${email}`); }
      const phone = s(o.phone, 40);
      if (phone) { if (phone.replace(/\D/g, "").length < 7) throw new UserError(`"${phone}" is not a phone number.`); said.push(`phone ${phone}`); }
      if (!Object.keys(set).length && !email && !phone) throw new UserError("update_lead_contact needs something to change.");
      return { params: { person_id: p.id, set, email: email || null, phone: phone || null }, label: `✎ ${p.full_name}`, detail: said.join(" · ").slice(0, 280) };
    },
    scopes: (_c, p) => [rowScope("sales_people", p.person_id as number)],
    async run(_c, p) {
      const set = p.set as Record<string, unknown>;
      const keys = Object.keys(set);
      if (keys.length) await q(`update sales_people set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [p.person_id, ...keys.map((k) => set[k])]);
      if (p.email) await q("update sales_people set emails = case when $2 = any(emails) then emails else array_append(emails, $2) end where id = $1", [p.person_id, p.email]);
      if (p.phone) await q("update sales_people set phones = case when $2 = any(phones) then phones else array_append(phones, $2) end where id = $1", [p.person_id, p.phone]);
      return "Updated.";
    },
  },

  add_lead: {
    doc: "add_lead: title (deal name), person (full name), company, value (\"2 lakh\"), currency, source (outbound|inbound|referral|network|…), requirements, email, phone: create a new lead",
    async prepare(_c, o) {
      const person = s(o.person, 120);
      const company = s(o.company, 160);
      const title = s(o.title, 200) || [company, person].filter(Boolean).join(": ");
      if (!title) throw new UserError("add_lead needs a name, a person or a company.");
      const value = has(o, "value") ? amountOf(o.value) : null;
      if (has(o, "value") && value === null) throw new UserError(`"${s(o.value, 30)}" is not an amount.`);
      return {
        params: { title, person, company, value, currency: s(o.currency, 5).toUpperCase() || null, source: s(o.source, 20) || null, requirements: s(o.requirements, 2000) || null, email: s(o.email, 200) || null, phone: s(o.phone, 40) || null },
        label: `＋ New lead: ${title}`,
        detail: [person, company, value ? value.toLocaleString("en-IN") : null].filter(Boolean).join(" · ") || null,
      };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const personId = p.person ? await upsertPerson({ name: p.person as string, company: (p.company as string) || undefined, email: (p.email as string) || undefined, phone: (p.phone as string) || undefined }) : null;
      const companyId = personId ? (await one<{ company_id: number | null }>("select company_id from sales_people where id = $1", [personId]))?.company_id ?? null : null;
      const id = await createDeal({
        title: p.title as string, person_id: personId, company_id: companyId, source: (p.source as string) ?? "network",
        value_amount: (p.value as number) ?? null, currency: (p.currency as string) ?? undefined, requirements: (p.requirements as string) ?? null,
      } as Parameters<typeof createDeal>[0]);
      undo.created.push({ table: "sales_deals", id });
      await refreshMoves(id).catch(() => {});
      return `Created (deal_id ${id}).`;
    },
  },

  add_target: {
    doc: "add_target: text (the owner's own words, e.g. \"I'm travelling to Udaipur in 15 days for 4 days, hotels and wedding planners\" or \"Dubai real estate brokers\"): a radar target or trip that searches for leads on its own. A trip finds local businesses and its messages ask to meet in person during the visit; it stops after the last day",
    async prepare(_c, o) {
      const text = s(o.text, 1500);
      if (!text) throw new UserError("add_target needs the owner's words: a place, dates, an industry, anything to target.");
      const { parseTarget } = await import("../sales/targets");
      const { by: _by, ...t } = await parseTarget(text);
      const trip = t.kind === "trip";
      const params = {
        ...t, sweep_sources: !trip,
        ...(trip ? { schedule: "interval", every_hours: 8, window_from: 7, window_to: 23, signals: t.signals ?? ["requirement", "hiring", "launch", "review"] } : {}),
      };
      const { validateHunt } = await import("../sales/hunts");
      validateHunt(params as Parameters<typeof validateHunt>[0]);
      const where = (t.cities ?? []).join(", ") || (t.countries ?? []).join(", ");
      return {
        params,
        label: `＋ ${trip ? "Trip" : "Target"}: ${t.name}`,
        detail: [where, trip && t.trip_from && t.trip_to ? `${t.trip_from} to ${t.trip_to}` : null, (t.industries ?? []).slice(0, 4).join(", ") || null].filter(Boolean).join(" · ") || null,
      };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const { runHuntNow, saveHunt } = await import("../sales/hunts");
      const id = await saveHunt(p as Parameters<typeof saveHunt>[0]);
      undo.created.push({ table: "sales_hunts", id });
      await runHuntNow(id).catch(() => {});
      return `Started (target ${id}). The first search runs within a minute; leads appear on the Radar under its name.`;
    },
  },

  update_company: {
    doc: "update_company: deal_id (or company_id) + any of name, website, industry, city, country, phone, email, linkedin, address, employees, description: the business the lead belongs to (their clinic, shop, firm). Creates and links it to the deal when there is none; research starts when a website or a new business is added",
    async prepare(_c, o) {
      let cid = int(o.company_id);
      let dealId: number | null = null;
      if (cid === null && has(o, "deal_id")) { const d = await dealOr(o.deal_id); dealId = d.id; cid = (await one<{ company_id: number | null }>("select company_id from sales_deals where id = $1", [d.id]))?.company_id ?? null; }
      const set: Record<string, unknown> = {};
      const said: string[] = [];
      for (const k of ["name", "website", "industry", "city", "country", "phone", "email", "linkedin", "address", "description"]) {
        if (!has(o, k)) continue;
        const v = isClear(o[k]) ? null : s(o[k], k === "description" ? 2000 : 300) || null;
        if (k === "website" && v && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(v)) throw new UserError(`"${v}" is not a website address.`);
        set[k] = k === "website" && v && !/^https?:\/\//i.test(v) ? `https://${v}` : v;
        said.push(`${k}: ${v ?? "cleared"}`);
      }
      if (has(o, "employees")) { const n = num(o.employees); if (n !== null) { set.employees = Math.round(n); said.push(`employees: ${set.employees}`); } }
      if (!Object.keys(set).length) throw new UserError("update_company needs something to change (name, website, city...).");
      if (cid === null && !set.name && !set.website) throw new UserError("This lead has no business yet: give its name or website.");
      const name = cid ? (await one<{ name: string }>("select name from sales_companies where id = $1", [cid]))?.name : String(set.name ?? set.website);
      return { params: { company_id: cid, deal_id: dealId, set }, label: `🏢 ${cid ? name : `New business: ${name}`}`, detail: said.join(" · ").slice(0, 280) };
    },
    scopes: (_c, p) => [...(p.company_id ? [rowScope("sales_companies", p.company_id as number)] : []), ...(p.deal_id ? [rowScope("sales_deals", p.deal_id as number)] : [])],
    async run(_c, p, undo) {
      const set = { ...(p.set as Record<string, unknown>) };
      let cid = (p.company_id as number | null) ?? null;
      const { ensureCompany, domainOf } = await import("../sales/identity");
      if (!cid) {
        cid = await ensureCompany((set.name as string) ?? null, { website: (set.website as string) ?? null });
        if (!cid) throw new UserError("Could not create the business.");
        undo.created.push({ table: "sales_companies", id: cid });
        await q("update sales_deals set company_id = $2 where id = $1", [p.deal_id, cid]);
        await q("update sales_people set company_id = $2 where id = (select person_id from sales_deals where id = $1) and company_id is null", [p.deal_id, cid]);
      }
      if (set.website) {
        const dom = domainOf(String(set.website));
        if (dom && !(await one("select 1 from sales_companies where lower(domain) = lower($1) and id <> $2", [dom, cid]))) set.domain = dom;
        set.website_source = "you";
      }
      const keys = Object.keys(set);
      if (keys.length) await q(`update sales_companies set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [cid, ...keys.map((k) => set[k])]);
      const { enqueue } = await import("../sales/jobs");
      if (set.website || !p.company_id) {
        await enqueue("enrich_company", { id: cid }, { dedupeKey: `enrich_company:${cid}` });
        if (set.website) await enqueue("audit_website", { id: cid }, { dedupeKey: `audit:${cid}` });
        return "Saved. Researching the business now.";
      }
      return "Saved.";
    },
  },

  close_promise: {
    doc: "close_promise: commitment_id (from the lead's OPEN PROMISES), status (done|dropped): a promise that was kept or no longer matters",
    async prepare(_c, o) {
      const id = int(o.commitment_id ?? o.id);
      const c = id === null ? null : await one<{ id: number; text: string; owner: string; deal_id: number | null }>("select id, text, owner, deal_id from sales_commitments where id = $1 and status = 'open'", [id]);
      if (!c) throw new UserError("That open promise does not exist. Query sales_commitments where status = 'open' for the lead.");
      const status = s(o.status, 10) === "dropped" ? "dropped" : "done";
      return { params: { id: c.id, status, deal_id: c.deal_id }, label: `${status === "done" ? "✓ Kept" : "✕ Dropped"}: ${c.text.slice(0, 60)}`, detail: c.owner === "me" ? "your promise" : "their promise" };
    },
    scopes: (_c, p) => [rowScope("sales_commitments", p.id as number)],
    async run(_c, p) {
      await q("update sales_commitments set status = $2, done_at = now() where id = $1", [p.id, p.status]);
      if (p.deal_id) await refreshMoves(p.deal_id as number).catch(() => {});
      return "Closed.";
    },
  },

  finish_move: {
    doc: "finish_move: move_id (from the lead's OPEN MOVES), status (done|skipped|snoozed), until (YYYY-MM-DD, for snoozed): mark a planned move done, not needed, or later",
    async prepare(c, o) {
      const id = int(o.move_id ?? o.id);
      const m = id === null ? null : await one<{ id: number; title: string; deal_id: number | null }>("select id, title, deal_id from sales_moves where id = $1 and status in ('open','snoozed')", [id]);
      if (!m) throw new UserError("That open move does not exist. Query sales_moves where status = 'open' for the lead.");
      const st = s(o.status, 10);
      const status = st === "skipped" ? "skipped" : st === "snoozed" ? "snoozed" : "done";
      const until = status === "snoozed" ? dateArg(c, o.until ?? "tomorrow") : null;
      return { params: { id: m.id, status, until, deal_id: m.deal_id }, label: `${status === "done" ? "✓ Done" : status === "skipped" ? "✕ Skipped" : "⏰ Later"}: ${m.title.slice(0, 60)}`, detail: until ? `until ${until}` : null };
    },
    scopes: (_c, p) => [rowScope("sales_moves", p.id as number)],
    async run(_c, p) {
      if (p.status === "snoozed") await q("update sales_moves set status = 'snoozed', snoozed_until = $2::date where id = $1", [p.id, p.until]);
      else if (p.status === "done") {
        // done is logged on the lead's timeline, the same as ticking it on the page
        const { completeMove } = await import("../sales/act");
        await completeMove(p.id as number, null);
        return "Done, and logged on the lead.";
      } else await q("update sales_moves set status = $2, done_at = now() where id = $1", [p.id, p.status]);
      return "Updated.";
    },
  },

  book_meeting: {
    doc: "book_meeting: deal_id, date (YYYY-MM-DD or tomorrow), time (HH:MM), minutes (default 30), title, place (address or video link): a call or meeting with the lead",
    async prepare(c, o) {
      const d = await dealOr(o.deal_id);
      const date = dateArg(c, o.date);
      const at = localTime(c, s(o.time, 10) || "11:00", date);
      const minutes = Math.max(10, Math.min(480, Math.round(num(o.minutes) ?? 30)));
      const title = s(o.title, 200) || `Call: ${d.title}`;
      return { params: { deal_id: d.id, person_id: d.person_id, at: at.toISOString(), minutes, title, place: s(o.place, 300) || null }, label: `📅 ${title}`, detail: `${at.toLocaleString("en-IN", { timeZone: c.tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}, ${minutes} min` };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const r = await one<{ id: number }>(
        "insert into sales_meetings (external_id, deal_id, person_id, title, starts_at, ends_at, link, place) values ($1,$2,$3,$4,$5,$5::timestamptz + make_interval(mins => $6),$7,$7) returning id",
        [`chat:${p.deal_id}:${p.at}`, p.deal_id, p.person_id, p.title, p.at, p.minutes, p.place]);
      undo.created.push({ table: "sales_meetings", id: r!.id });
      await refreshMoves(p.deal_id as number).catch(() => {});
      return "Booked.";
    },
  },

  research_lead: {
    doc: "research_lead: deal_id, what (company|person|both, default both): research the business (and check its website) and the contact now",
    async prepare(_c, o) {
      const d = await dealOr(o.deal_id);
      const what = ["company", "person"].includes(s(o.what, 10)) ? s(o.what, 10) : "both";
      const co = (await one<{ company_id: number | null }>("select company_id from sales_deals where id = $1", [d.id]))?.company_id ?? null;
      if ((what === "company" || what === "both") && !co && what === "company") throw new UserError("This lead has no business yet: add it with update_company first.");
      return { params: { deal_id: d.id, company_id: co, person_id: d.person_id, what }, label: `🔎 Research ${what === "both" ? "the business and the contact" : what === "company" ? "the business" : "the contact"}`, detail: d.title };
    },
    scopes: () => [],
    async run(_c, p) {
      const { enqueue } = await import("../sales/jobs");
      if (p.company_id && p.what !== "person") { await enqueue("enrich_company", { id: p.company_id }, { dedupeKey: `enrich_company:${p.company_id}` }); await enqueue("audit_website", { id: p.company_id }, { dedupeKey: `audit:${p.company_id}` }); }
      if (p.person_id && p.what !== "company") await enqueue("enrich_person", { id: p.person_id }, { dedupeKey: `enrich_person:${p.person_id}` });
      return "Started. Results land on the lead in a few minutes.";
    },
  },

  save_draft: {
    doc: "save_draft: deal_id, message (the full text, ready to send), channel (whatsapp|email|linkedin|instagram|sms), subject (email only), title (what it is for): saves a message you wrote with the owner as a ready move with Send buttons",
    async prepare(_c, o) {
      const d = await dealOr(o.deal_id);
      const message = s(o.message ?? o.text, 4000);
      if (!message) throw new UserError("save_draft needs the message.");
      const channel = ["whatsapp", "email", "linkedin", "instagram", "sms"].includes(s(o.channel, 12)) ? s(o.channel, 12) : "whatsapp";
      const title = s(o.title, 200) || `Send: ${message.split("\n")[0].slice(0, 60)}`;
      return { params: { deal_id: d.id, message, channel, subject: s(o.subject, 200) || null, title }, label: `✉️ Ready to send (${channel}): ${title.slice(0, 50)}`, detail: message.slice(0, 200) };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const { noDashes } = await import("../text/no-dashes");
      const r = await one<{ id: number }>(
        `insert into sales_moves (deal_id, kind, title, why, channel, due_at, draft, ai_draft, draft_subject, created_by, dedupe_key)
         values ($1, 'custom', $2, 'Written with you in the chat', $3, now(), $4, $4, $5, 'ai', $6) returning id`,
        [p.deal_id, p.title, p.channel, noDashes(p.message as string), p.subject, `chat:${p.deal_id}:${Date.now()}`]);
      undo.created.push({ table: "sales_moves", id: r!.id });
      return "Saved. It is in Moves, ready to send.";
    },
  },

  set_lead_draft: {
    doc: "set_lead_draft: radar_item_id OR deal_id, message (the full new text, ready to send), channel (whatsapp|email|linkedin|instagram|sms|platform, optional), subject (email only): replaces the message drafted for this lead (the one shown on the lead with its Send buttons) when the owner asks to change, shorten, translate or redo it, or when what they told you changes what it should say",
    async prepare(_c, o) {
      const message = s(o.message ?? o.text, 4000);
      if (!message) throw new UserError("set_lead_draft needs the new message.");
      const channel = ["whatsapp", "email", "linkedin", "instagram", "sms", "platform"].includes(s(o.channel, 12)) ? s(o.channel, 12) : null;
      const rid = int(o.radar_item_id);
      let move: { id: number; title: string; channel: string | null } | null = null;
      let dealId: number | null = null;
      let label = "";
      if (rid !== null) {
        const it = await one<{ id: number; title: string; deal_id: number | null }>("select id, title, deal_id from sales_radar_items where id = $1", [rid]);
        if (!it) throw new UserError("That radar lead does not exist.");
        move = await one<{ id: number; title: string; channel: string | null }>("select id, title, channel from sales_moves where dedupe_key = $1 and status in ('open','snoozed')", [`radar:${rid}`]);
        dealId = it.deal_id;
        label = it.title;
      } else {
        const d = await dealOr(o.deal_id);
        dealId = d.id;
        label = d.title;
        // the message waiting to be sent on this deal: the one drafted most recently, else the first due
        type M = { id: number; title: string; channel: string | null };
        move = await one<M>("select id, title, channel from sales_moves where deal_id = $1 and status in ('open','snoozed') and draft is not null order by created_at desc limit 1", [d.id])
          ?? await one<M>("select id, title, channel from sales_moves where deal_id = $1 and status in ('open','snoozed') order by due_at limit 1", [d.id]);
      }
      return {
        params: { move_id: move?.id ?? null, radar_item_id: rid, deal_id: dealId, message, channel: channel ?? move?.channel ?? null, subject: s(o.subject, 200) || null, title: move?.title ?? `Message to ${label.slice(0, 60)}` },
        label: `✏️ Draft updated: ${(move?.title ?? label).slice(0, 50)}`, detail: message.slice(0, 200),
      };
    },
    scopes: (_c, p) => (p.move_id ? [rowScope("sales_moves", p.move_id as number)] : []),
    async run(_c, p, undo) {
      const { noDashes } = await import("../text/no-dashes");
      const text = noDashes(p.message as string);
      if (p.move_id) {
        await q("update sales_moves set draft = $2, channel = coalesce($3, channel), draft_subject = coalesce($4, draft_subject) where id = $1", [p.move_id, text, p.channel, p.subject]);
        return "Draft updated on the lead.";
      }
      const r = await one<{ id: number }>(
        `insert into sales_moves (deal_id, radar_item_id, kind, title, why, channel, due_at, draft, ai_draft, draft_subject, created_by, dedupe_key)
         values ($1, $2, $3, $4, 'Written with you in the chat', $5, now(), $6, $6, $7, 'ai', $8) returning id`,
        [p.deal_id, p.radar_item_id, p.radar_item_id && !p.deal_id ? "radar" : "custom", p.title, p.channel, text, p.subject,
          p.radar_item_id && !p.deal_id ? `radar:${p.radar_item_id}` : `chat:${p.deal_id}:${Date.now()}`]);
      undo.created.push({ table: "sales_moves", id: r!.id });
      return "Draft saved on the lead.";
    },
  },

  prepare_doc: {
    doc: "prepare_doc: deal_id, title, body (Markdown: a demo plan, proposal outline, call script, notes): saves a working document on the lead (only you see it)",
    async prepare(_c, o) {
      const d = await dealOr(o.deal_id);
      const title = s(o.title, 200);
      const body = s(o.body ?? o.text, 20_000);
      if (!title || !body) throw new UserError("prepare_doc needs a title and the body.");
      return { params: { deal_id: d.id, title, body }, label: `📄 ${title}`, detail: body.slice(0, 160) };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const { createLinkDoc } = await import("../sales/docs");
      const { noDashes } = await import("../text/no-dashes");
      const id = await createLinkDoc({ deal_id: p.deal_id as number, title: p.title as string, kind: "brief", body: noDashes(p.body as string), internal: true, category: "prep" });
      undo.created.push({ table: "sales_docs", id });
      return "Saved on the lead.";
    },
  },

  do_everything: {
    doc: "do_everything: deal_id: does all the work the AI can on this lead now (refreshes its moves, writes the messages that are due, researches the contact and business, writes a prep note when the next step is a demo or proposal)",
    async prepare(_c, o) {
      const d = await dealOr(o.deal_id);
      return { params: { deal_id: d.id }, label: `🤖 Do everything possible on ${d.title}`, detail: "messages due, research, prep note for the next step" };
    },
    scopes: () => [],
    async run(_c, p) {
      const { dealAutopilot } = await import("../sales/autopilot");
      const items = await dealAutopilot(p.deal_id as number, "chat");
      return items.length ? `Started: ${items.map((x) => x.label).join("; ")}.` : "Nothing more to do right now: messages are written and research is done.";
    },
  },
};

/** When a note from the chat happened: a time on the owner's clock, a past day at noon, today means now. */
export function noteTime(at: string | null | undefined, tz: string, now: Date): string | null {
  if (!at) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(at) && at === calendarDate(now, tz)) return null;
  return messageAt(at, tz, now);
}
