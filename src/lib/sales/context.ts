/** Plain-text context about a deal, for drafts, briefs and summaries. */
import { one, q } from "../db";
import { getDeal } from "./deals";

export const iso = (x: unknown): string => (x ? new Date(x as string).toISOString() : "");

export async function dealContext(dealId: number, opts: { interactions?: number } = {}): Promise<string> {
  const d = await getDeal(dealId);
  if (!d) return "";
  const person = d.person_id
    ? await one<{ full_name: string; title: string | null; country: string | null; city: string | null; relationship: string; enrichment: Record<string, { v?: unknown }> }>(
        "select full_name, title, country, city, relationship, enrichment from sales_people where id = $1",
        [d.person_id],
      )
    : null;
  const company = d.company_id
    ? await one<{ name: string; industry: string | null; country: string | null; website: string | null; employees: number | null; revenue_usd: number | null; description: string | null; audit: { summary?: string } | null }>(
        "select name, industry, country, website, employees, revenue_usd, description, audit from sales_companies where id = $1",
        [d.company_id],
      )
    : null;
  const commits = await q<{ owner: string; text: string; due_at: string | null }>(
    "select owner, text, due_at from sales_commitments where deal_id = $1 and status = 'open' order by due_at nulls last limit 10",
    [dealId],
  );
  const recent = await q<{ channel: string; direction: string; occurred_at: string; summary: string | null; body: string | null; subject: string | null }>(
    "select channel, direction, occurred_at, summary, body, subject from sales_interactions where deal_id = $1 order by occurred_at desc limit $2",
    [dealId, opts.interactions ?? 8],
  );
  const docs = await q<{ title: string; kind: string; status: string; view_count: number; last_viewed_at: string | null; current_rev: number }>(
    "select title, kind, status, view_count, last_viewed_at, current_rev from sales_docs where deal_id = $1 order by updated_at desc limit 5",
    [dealId],
  );
  const lines: string[] = [];
  lines.push(`DEAL: ${d.title} | stage: ${d.stage_name} | source: ${d.source}${d.source_detail ? ` (${d.source_detail})` : ""}`);
  if (d.value_amount) lines.push(`VALUE: ${d.currency} ${d.value_amount}`);
  if (person) {
    const e = person.enrichment ?? {};
    const pick = (k: string) => (e[k]?.v ? String(e[k].v) : null);
    lines.push(`CONTACT: ${person.full_name}${person.title ? `, ${person.title}` : ""}${person.city || person.country ? ` (${[person.city, person.country].filter(Boolean).join(", ")})` : ""}, relationship: ${person.relationship}`);
    const extra = [pick("career_summary"), pick("talking_points"), pick("communication_style")].filter(Boolean);
    if (extra.length) lines.push(`ABOUT THEM: ${extra.join(" | ").slice(0, 600)}`);
  }
  if (company) {
    lines.push(`COMPANY: ${company.name}${company.industry ? `, ${company.industry}` : ""}${company.country ? `, ${company.country}` : ""}${company.employees ? `, ~${company.employees} people` : ""}${company.website ? `, ${company.website}` : ""}`);
    if (company.description) lines.push(`WHAT THEY DO: ${company.description.slice(0, 400)}`);
    if (company.audit?.summary) lines.push(`WEBSITE AUDIT: ${company.audit.summary.slice(0, 500)}`);
  }
  if (d.referrer_name) lines.push(`REFERRED BY: ${d.referrer_name}`);
  if (d.intermediary_name) lines.push(`INTERMEDIARY: ${d.intermediary_name} (${d.intermediary_type ?? "partner"})${d.talk_via_intermediary ? ", talk to the client through them" : ""}`);
  if (d.summary) lines.push(`WHERE WE ARE: ${d.summary}`);
  if (d.requirements) lines.push(`REQUIREMENTS: ${d.requirements}`);
  if (d.budget) lines.push(`BUDGET: ${d.budget}`);
  if (d.timeline) lines.push(`TIMELINE: ${d.timeline}`);
  if (d.objections?.length) lines.push(`OBJECTIONS: ${d.objections.join("; ")}`);
  if (commits.length) lines.push(`OPEN PROMISES:\n${commits.map((c) => `- ${c.owner === "me" ? "I promised" : "They promised"}: ${c.text}${c.due_at ? ` (by ${iso(c.due_at).slice(0, 10)})` : ""}`).join("\n")}`);
  if (docs.length) lines.push(`DOCUMENTS: ${docs.map((x) => `${x.title} v${x.current_rev} ${x.status}, opened ${x.view_count}x`).join("; ")}`);
  if (recent.length) {
    lines.push("RECENT TOUCHES (newest first):");
    for (const r of recent) {
      const text = (r.summary || r.subject || r.body || "").replace(/\s+/g, " ").slice(0, 350);
      lines.push(`- ${iso(r.occurred_at).slice(0, 16).replace("T", " ")} ${r.channel} ${r.direction === "in" ? "FROM THEM" : r.direction === "out" ? "FROM ME" : r.direction}: ${text}`);
    }
  }
  return lines.join("\n");
}
