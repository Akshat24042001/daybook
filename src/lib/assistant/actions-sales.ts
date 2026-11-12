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
import type { Ctx } from "../settings";
import { has, int, isClear, num, rowScope, s, strList, type Scope, type Snapshot } from "./action-kit";

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
    doc: "log_deal_note: deal_id, text, channel (note|call|meeting|whatsapp|email|linkedin|in_person|instagram; default note), direction (in|out|both), occurred_at (YYYY-MM-DD): add something that happened to the lead's timeline",
    async prepare(_c, o) {
      const d = await dealOr(o.deal_id);
      const text = s(o.text ?? o.note ?? o.body, 4000);
      if (!text) throw new UserError("log_deal_note needs the text.");
      // "type" is the action's own name, so the kind of touch comes in "channel"
      const type = s(o.channel ?? o.kind, 20).toLowerCase() || "note";
      const direction = ["in", "out", "both"].includes(s(o.direction, 5)) ? s(o.direction, 5) : undefined;
      const at = has(o, "occurred_at") ? isoDay(o.occurred_at) : null;
      return { params: { deal_id: d.id, person_id: d.person_id, text, type, direction, at }, label: `＋ ${type === "note" ? "Note" : type} on ${d.title}`, detail: text.slice(0, 200) };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const id = await logActivity(p.deal_id as number, {
        type: p.type as string, direction: p.direction as never, body: p.text as string, subject: null, person_id: (p.person_id as number) ?? null,
        occurred_at: p.at ? `${p.at}T06:30:00.000Z` : null,
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
};
