/**
 * What a lead has told you, and what you wrote down about them, in one place: the deal's requirement, problem, hoped-for
 * outcome, services, budget and timeline, the deal summary, and their latest messages. The opportunity audit is built
 * on this first, and a fingerprint of it tells when the audit is out of date (they said something new).
 */
import { one, q } from "../db";

export interface LeadSaid { text: string; hash: string; dealId: number | null }

/** A short, stable fingerprint of a text (FNV-1a). Pure. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export async function leadSaid(companyId: number): Promise<LeadSaid> {
  const d = await one<{ id: number; title: string | null; requirements: string | null; pain: string | null; desired_outcome: string | null; impact: string | null;
    current_solution: string | null; services: string[] | null; budget: string | null; timeline: string | null; summary: string | null; next_action: string | null; notes: string | null }>(
    `select d.id, d.title, d.requirements, d.pain, d.desired_outcome, d.impact, d.current_solution, d.services, d.budget, d.timeline, d.summary, d.next_action, d.notes
       from sales_deals d left join sales_stages s on s.id = d.stage_id
      where d.company_id = $1 order by (s.category = 'open') desc, d.updated_at desc limit 1`, [companyId]);
  if (!d) return { text: "", hash: fingerprint(""), dealId: null };
  const msgs = await q<{ at: string; text: string }>(
    `select to_char(occurred_at, 'YYYY-MM-DD') as at, coalesce(nullif(summary, ''), left(body, 700)) as text from sales_interactions
      where deal_id = $1 and direction in ('in','both') and coalesce(summary, body) is not null order by occurred_at desc limit 8`, [d.id]);
  const lines = [
    d.requirements ? `What they need: ${d.requirements}` : null,
    d.pain ? `Their problem: ${d.pain}` : null,
    d.desired_outcome ? `What they want to achieve: ${d.desired_outcome}` : null,
    d.impact ? `Impact for them: ${d.impact}` : null,
    d.current_solution ? `What they use today: ${d.current_solution}` : null,
    d.services?.length ? `Services discussed: ${d.services.join(", ")}` : null,
    d.budget ? `Budget: ${d.budget}` : null,
    d.timeline ? `Timeline: ${d.timeline}` : null,
    d.notes ? `Your notes: ${d.notes}` : null,
    d.summary ? `Where it stands: ${d.summary}` : null,
    d.next_action ? `Next step: ${d.next_action}` : null,
    ...msgs.reverse().map((m) => `They said (${m.at}): ${m.text.replace(/\s+/g, " ")}`),
  ].filter(Boolean) as string[];
  const text = lines.join("\n").slice(0, 6000);
  // the fingerprint ignores the summary and next step (they are rewritten after every log): only new facts count
  const facts = [d.requirements, d.pain, d.desired_outcome, d.impact, d.current_solution, (d.services ?? []).join(","), d.budget, d.timeline, d.notes, ...msgs.map((m) => m.text)].join("|");
  return { text, hash: fingerprint(facts), dealId: d.id };
}

/** True when the company's audit was written before what the lead has said since (or there is none). */
export async function auditStale(companyId: number): Promise<boolean> {
  const c = await one<{ audit: { based_on?: { hash?: string } } | null; identity: string | null }>(
    "select audit, enrichment->'identity_match'->>'v' as identity from sales_companies where id = $1", [companyId]);
  if (!c) return false;
  const said = await leadSaid(companyId);
  if (!said.text && c.audit) return false;
  return !c.audit?.based_on?.hash || c.audit.based_on.hash !== said.hash;
}
