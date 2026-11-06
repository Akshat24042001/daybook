/**
 * Tracked documents. Instead of attachments you send a link: a quote (with revisions), an opportunity brief, a file, or
 * any URL (Loom, Drive, a case study). No password for the client; the link is unguessable. Every open is recorded
 * (when, where, which device, how long, which revision) and pushed to Telegram.
 */
import { one, q, UserError } from "../db";
import { salesConfig } from "./config";
import { getDeal, logInteraction } from "./deals";
import { baseUrl, newSlug } from "./links";
import { escalate, push } from "./notify";
import { applyEvent } from "./stages";
import { esc } from "../telegram/api";

export interface QuoteItem {
  name: string;
  description?: string;
  qty: number;
  unit_price: number;
}
export interface PaymentStep {
  label: string;
  percent: number;
  /** "on acceptance", "on delivery", or days after acceptance */
  when: string;
}

export interface DocRow {
  id: number;
  slug: string;
  kind: "quote" | "brief" | "link" | "file";
  deal_id: number | null;
  company_id: number | null;
  title: string;
  target_url: string | null;
  file_path: string | null;
  file_name: string | null;
  body: string | null;
  status: string;
  current_rev: number;
  sent_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  accepted_at: string | null;
  accepted_by: string | null;
  client_note: string | null;
  expires_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface RevisionRow {
  id: number;
  doc_id: number;
  rev: number;
  currency: string;
  items: QuoteItem[];
  discount: number;
  tax_pct: number;
  total: number;
  intro: string | null;
  scope: string | null;
  timeline: string | null;
  terms: string | null;
  payment_plan: PaymentStep[];
  validity_days: number;
  change_note: string | null;
  sent_at: string | null;
  created_at: string;
}

export const DEFAULT_PLAN: PaymentStep[] = [
  { label: "Advance", percent: 50, when: "on acceptance" },
  { label: "On delivery", percent: 50, when: "on delivery" },
];

export const DEFAULT_TERMS =
  "Fixed scope, fixed price. Work starts when the advance is received. Changes outside the scope above are quoted separately before any work. Source code and accounts are handed over when the final payment is made. Prices exclude third-party costs (hosting, APIs, licences) unless listed.";

export function docUrl(slug: string): string {
  return `${baseUrl()}/q/${slug}`;
}

export function totalOf(items: QuoteItem[], discount: number, taxPct: number): number {
  const sub = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
  const after = Math.max(0, sub - (Number(discount) || 0));
  return Math.round((after * (1 + (Number(taxPct) || 0) / 100)) * 100) / 100;
}

export async function listDocs(dealId?: number): Promise<(DocRow & { deal_title: string | null; total: number | null; currency: string | null })[]> {
  return q(
    `select x.*, d.title as deal_title, r.total, r.currency from sales_docs x
     left join sales_deals d on d.id = x.deal_id
     left join sales_quote_revisions r on r.doc_id = x.id and r.rev = x.current_rev
     where ($1::int is null or x.deal_id = $1) order by x.updated_at desc limit 300`,
    [dealId ?? null],
  );
}

export async function getDoc(id: number): Promise<DocRow | null> {
  return one<DocRow>("select * from sales_docs where id = $1", [id]);
}

export async function docBySlug(slug: string): Promise<DocRow | null> {
  return one<DocRow>("select * from sales_docs where slug = $1", [slug]);
}

export async function revisions(docId: number): Promise<RevisionRow[]> {
  return q<RevisionRow>("select * from sales_quote_revisions where doc_id = $1 order by rev desc", [docId]);
}

export async function createQuote(dealId: number, title?: string): Promise<number> {
  const deal = await getDeal(dealId);
  if (!deal) throw new UserError("Deal not found.");
  const cfg = await salesConfig();
  const doc = await one<{ id: number }>(
    "insert into sales_docs (slug, kind, deal_id, company_id, title) values ($1,'quote',$2,$3,$4) returning id",
    [newSlug(), dealId, deal.company_id, title?.trim() || `Proposal for ${deal.company_name ?? deal.title}`],
  );
  const items: QuoteItem[] = deal.value_amount ? [{ name: deal.services?.[0] ?? "Project", description: deal.requirements?.slice(0, 300) ?? "", qty: 1, unit_price: Number(deal.value_amount) }] : [];
  await q(
    `insert into sales_quote_revisions (doc_id, rev, currency, items, total, intro, scope, terms, payment_plan)
     values ($1,1,$2,$3,$4,$5,$6,$7,$8)`,
    [doc!.id, deal.currency || cfg.default_currency, JSON.stringify(items), totalOf(items, 0, 0),
      `Hi ${deal.person_name?.split(" ")[0] ?? "there"}, here is what we discussed, in one place.`, deal.requirements ?? "", DEFAULT_TERMS, JSON.stringify(DEFAULT_PLAN)],
  );
  return doc!.id;
}

export async function saveRevision(docId: number, r: Partial<RevisionRow>): Promise<void> {
  const doc = await getDoc(docId);
  if (!doc) throw new UserError("Document not found.");
  const cur = await one<RevisionRow>("select * from sales_quote_revisions where doc_id = $1 and rev = $2", [docId, doc.current_rev]);
  if (!cur) throw new UserError("Revision not found.");
  if (cur.sent_at) throw new UserError(`v${cur.rev} was already sent. Make a new revision so the client's history stays honest.`);
  const items = (r.items ?? cur.items).map((i) => ({ name: String(i.name ?? ""), description: String(i.description ?? ""), qty: Number(i.qty) || 1, unit_price: Number(i.unit_price) || 0 }));
  const discount = r.discount ?? cur.discount;
  const tax = r.tax_pct ?? cur.tax_pct;
  await q(
    `update sales_quote_revisions set currency = $3, items = $4, discount = $5, tax_pct = $6, total = $7, intro = $8, scope = $9,
       timeline = $10, terms = $11, payment_plan = $12, validity_days = $13, change_note = $14 where doc_id = $1 and rev = $2`,
    [docId, cur.rev, (r.currency ?? cur.currency).toUpperCase(), JSON.stringify(items), discount, tax, totalOf(items, discount, tax),
      r.intro ?? cur.intro, r.scope ?? cur.scope, r.timeline ?? cur.timeline, r.terms ?? cur.terms, JSON.stringify(r.payment_plan ?? cur.payment_plan),
      r.validity_days ?? cur.validity_days, r.change_note ?? cur.change_note],
  );
  if (r.payment_plan) {
    const sum = r.payment_plan.reduce((s, p) => s + (Number(p.percent) || 0), 0);
    if (Math.round(sum) !== 100) throw new UserError(`The payment plan adds up to ${sum}%, not 100%.`);
  }
  await q("update sales_docs set updated_at = now() where id = $1", [docId]);
}

/** A new revision starts as a copy of the latest one. The client link always shows the newest sent revision. */
export async function newRevision(docId: number, changeNote: string): Promise<number> {
  const doc = await getDoc(docId);
  if (!doc) throw new UserError("Document not found.");
  const next = doc.current_rev + 1;
  await q(
    `insert into sales_quote_revisions (doc_id, rev, currency, items, discount, tax_pct, total, intro, scope, timeline, terms, payment_plan, validity_days, change_note)
     select doc_id, $2, currency, items, discount, tax_pct, total, intro, scope, timeline, terms, payment_plan, validity_days, $3
     from sales_quote_revisions where doc_id = $1 and rev = $4`,
    [docId, next, changeNote || null, doc.current_rev],
  );
  await q("update sales_docs set current_rev = $2, status = 'draft', updated_at = now() where id = $1", [docId, next]);
  return next;
}

/** Marks the current revision as sent: the deal moves to Proposal (or Negotiation for a revision). */
export async function markDocSent(docId: number, o: { logTouch?: boolean; channel?: string } = {}): Promise<void> {
  const doc = await getDoc(docId);
  if (!doc) throw new UserError("Document not found.");
  await q("update sales_docs set sent_at = coalesce(sent_at, now()), status = case when status in ('draft','changes') then 'sent' else status end, updated_at = now() where id = $1", [docId]);
  if (doc.kind === "quote") await q("update sales_quote_revisions set sent_at = coalesce(sent_at, now()) where doc_id = $1 and rev = $2", [docId, doc.current_rev]);
  if (!doc.deal_id) return;
  if (o.logTouch !== false) {
    await logInteraction({
      deal_id: doc.deal_id, channel: (o.channel as "document") ?? "document", direction: "out",
      summary: `Sent "${doc.title}"${doc.kind === "quote" ? ` v${doc.current_rev}` : ""}`, body: docUrl(doc.slug), source: "docs",
      external_id: `doc:${docId}:${doc.current_rev}`,
    });
  }
  if (doc.kind === "quote") await applyEvent(doc.deal_id, doc.current_rev > 1 ? "quote_revised" : "quote_sent");
  if (doc.kind === "quote" && doc.current_rev > 1) await applyEvent(doc.deal_id, "quote_sent");
}

export async function createLinkDoc(o: { deal_id: number | null; title: string; url?: string | null; kind?: "link" | "file" | "brief"; body?: string | null; file_path?: string | null; file_name?: string | null; company_id?: number | null }): Promise<number> {
  const kind = o.kind ?? "link";
  if (kind === "link" && !/^https?:\/\//i.test(o.url ?? "")) throw new UserError("Give a full link starting with https://");
  let companyId = o.company_id ?? null;
  if (!companyId && o.deal_id) companyId = (await getDeal(o.deal_id))?.company_id ?? null;
  const row = await one<{ id: number }>(
    "insert into sales_docs (slug, kind, deal_id, company_id, title, target_url, body, file_path, file_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
    [newSlug(), kind, o.deal_id, companyId, o.title.trim() || "Document", o.url ?? null, o.body ?? null, o.file_path ?? null, o.file_name ?? null],
  );
  return row!.id;
}

export async function deleteDoc(id: number): Promise<void> {
  await q("delete from sales_docs where id = $1", [id]);
}

// ------------------------------------------------------------------ the client side

const BOT_UA = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|linkedin|skype|embedly|vkshare|pinterest|outlook|googleimageproxy|bitlybot|curl|wget|python|node-fetch|headless/i;

export function isBot(ua: string | null | undefined): boolean {
  return !ua || BOT_UA.test(ua);
}

export function deviceOf(ua: string): string {
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/macintosh|mac os x/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows PC";
  if (/linux/i.test(ua)) return "Linux";
  return "Browser";
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** Records a client view (not bots, not you) and pushes it to Telegram when it is a fresh visit. */
export async function recordView(doc: DocRow, v: { ua: string; visitor: string; country?: string | null; city?: string | null; rev?: number | null }): Promise<number | null> {
  if (isBot(v.ua)) return null;
  const prev = await one<{ viewed_at: string }>("select viewed_at from sales_doc_views where doc_id = $1 order by viewed_at desc limit 1", [doc.id]);
  const row = await one<{ id: number }>(
    "insert into sales_doc_views (doc_id, rev, visitor, country, city, device, ua) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [doc.id, v.rev ?? doc.current_rev, v.visitor, v.country ?? null, v.city ?? null, deviceOf(v.ua), v.ua.slice(0, 300)],
  );
  const updated = await one<{ view_count: number }>(
    `update sales_docs set view_count = view_count + 1, first_viewed_at = coalesce(first_viewed_at, now()), last_viewed_at = now(),
       status = case when status = 'sent' then 'viewed' else status end where id = $1 returning view_count`,
    [doc.id],
  );
  const fresh = !prev || Date.now() - new Date(prev.viewed_at).getTime() > 30 * 60_000;
  if (fresh) {
    const deal = doc.deal_id ? await getDeal(doc.deal_id) : null;
    const whoName = deal ? `${deal.person_name ?? deal.title}${deal.company_name && deal.person_name ? ` (${deal.company_name})` : ""}` : "Someone";
    const where = [v.city, v.country].filter(Boolean).join(", ");
    const n = updated?.view_count ?? 1;
    const text = `👀 <b>${esc(whoName)}</b> opened <b>${esc(doc.title)}</b>${doc.kind === "quote" ? ` v${v.rev ?? doc.current_rev}` : ""}\n${ordinal(n)} open${where ? ` · ${esc(where)}` : ""} · ${deviceOf(v.ua)}`;
    const markup = deal ? { inline_keyboard: [[{ text: "Open deal", url: `${baseUrl()}/sales/deal/${deal.id}` }]] } : undefined;
    await push(text, markup);
    if (deal) {
      const recent = await one<{ n: number }>("select count(*)::int as n from sales_doc_views where doc_id = $1 and viewed_at > now() - interval '2 hours'", [doc.id]);
      if ((recent?.n ?? 0) >= 3 && doc.kind === "quote") {
        await escalate("proposal_hot", `hot:${doc.id}:${new Date().toISOString().slice(0, 10)}`, `${whoName} has opened your proposal ${recent?.n} times in the last two hours. Call them now.`);
      }
    }
  }
  return row?.id ?? null;
}

export async function addViewSeconds(viewId: number, seconds: number): Promise<void> {
  await q("update sales_doc_views set seconds = greatest(seconds, $2) where id = $1", [viewId, Math.min(4 * 3600, Math.max(0, Math.round(seconds)))]);
}

/** The client clicked Accept: the deal is Won, the payment plan becomes payments, you get pinged (and called if set). */
export async function acceptQuote(slug: string, name: string): Promise<void> {
  const doc = await docBySlug(slug);
  if (!doc || doc.kind !== "quote") throw new UserError("Quote not found.");
  if (doc.accepted_at) return;
  const rev = await one<RevisionRow>("select * from sales_quote_revisions where doc_id = $1 and rev = $2", [doc.id, doc.current_rev]);
  await q("update sales_docs set accepted_at = now(), accepted_by = $2, status = 'accepted' where id = $1", [doc.id, name.slice(0, 120)]);
  if (!doc.deal_id || !rev) return;
  await logInteraction({ deal_id: doc.deal_id, channel: "document", direction: "in", summary: `${name} accepted "${doc.title}" v${rev.rev} (${rev.currency} ${rev.total})`, source: "docs", external_id: `accept:${doc.id}` });
  await q("update sales_deals set value_amount = $2, currency = $3 where id = $1", [doc.deal_id, rev.total, rev.currency]);
  const cfg = await salesConfig();
  await q("update sales_deals set value_usd = $2 where id = $1", [doc.deal_id, Math.round(rev.total * (cfg.fx[rev.currency] ?? 1))]);
  await applyEvent(doc.deal_id, "quote_accepted");
  const existing = await one("select 1 from sales_payments where deal_id = $1", [doc.deal_id]);
  if (!existing) {
    for (const p of rev.payment_plan ?? []) {
      const days = Number(String(p.when).match(/(\d+)\s*day/)?.[1] ?? NaN);
      const due = /acceptance|advance|upfront/i.test(p.when) ? new Date() : Number.isFinite(days) ? new Date(Date.now() + days * 86_400_000) : null;
      await q("insert into sales_payments (deal_id, label, amount, currency, due_on) values ($1,$2,$3,$4,$5)", [
        doc.deal_id, `${p.label} (${p.percent}%)`, Math.round(rev.total * (Number(p.percent) || 0)) / 100, rev.currency, due ? due.toISOString().slice(0, 10) : null,
      ]);
    }
  }
  const deal = await getDeal(doc.deal_id);
  await push(`🎉 <b>${esc(name)}</b> accepted <b>${esc(doc.title)}</b> v${rev.rev}: ${rev.currency} ${rev.total.toLocaleString("en-IN")}\nDeal is now ${esc(deal?.stage_name ?? "Won")}. Next: collect the advance.`, {
    inline_keyboard: [[{ text: "Open deal", url: `${baseUrl()}/sales/deal/${doc.deal_id}` }]],
  });
  await escalate("quote_accepted", `accept:${doc.id}`, `${name} just accepted your proposal ${doc.title} for ${rev.currency} ${rev.total}.`);
}

export async function requestChanges(slug: string, name: string, note: string): Promise<void> {
  const doc = await docBySlug(slug);
  if (!doc) throw new UserError("Not found.");
  await q("update sales_docs set status = 'changes', client_note = $2, updated_at = now() where id = $1", [doc.id, `${name}: ${note}`.slice(0, 2000)]);
  if (doc.deal_id) {
    await logInteraction({ deal_id: doc.deal_id, channel: "document", direction: "in", summary: `${name} asked for changes on "${doc.title}"`, body: note.slice(0, 4000), source: "docs" });
  }
  await push(`✏️ <b>${esc(name)}</b> asked for changes on <b>${esc(doc.title)}</b>:\n${esc(note.slice(0, 600))}`, doc.deal_id ? { inline_keyboard: [[{ text: "Open deal", url: `${baseUrl()}/sales/deal/${doc.deal_id}` }]] } : undefined);
}
