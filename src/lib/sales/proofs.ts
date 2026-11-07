/**
 * The proof library: short case studies from work you delivered.
 *
 * - When a deal is delivered or paid in full, a draft case study is written from the deal's own record (requirements,
 *   conversation, what was built). Results are only ever taken from what was said or logged; when none was, the
 *   result is left empty for you to fill in. Nothing is invented.
 * - A draft is never used anywhere. Once you approve it, follow-ups, re-engages and upsells may cite it when it fits
 *   the lead (same service or industry), at most one per message.
 */
import { one, q, UserError } from "../db";
import { dealContext } from "./context";
import { enqueue } from "./jobs";
import { llmConfigured, llmJson } from "./llm";

export interface Proof {
  id: number;
  deal_id: number | null;
  deal_title: string | null;
  title: string;
  client: string | null;
  industry: string | null;
  country: string | null;
  services: string[];
  problem: string | null;
  solution: string | null;
  result: string | null;
  link: string | null;
  status: "draft" | "approved" | "archived";
  updated_at: string;
}

/** Delivered or paid deals with no case study yet get a draft written (one job each). */
export async function queueProofs(): Promise<number> {
  const rows = await q<{ id: number }>(
    `select d.id from sales_deals d join sales_stages s on s.id = d.stage_id
     where s.role in ('delivered','paid') and not exists (select 1 from sales_proofs p where p.deal_id = d.id)
     order by d.updated_at desc limit 5`,
  );
  for (const r of rows) await enqueue("draft_proof", { deal_id: r.id }, { dedupeKey: `draft_proof:${r.id}` });
  return rows.length;
}

export async function draftProof(dealId: number): Promise<number | null> {
  const existing = await one<{ id: number }>("select id from sales_proofs where deal_id = $1", [dealId]);
  if (existing) return existing.id;
  const d = await one<{ title: string; services: string[]; requirements: string | null; summary: string | null; company: string | null; industry: string | null; country: string | null }>(
    `select d.title, d.services, d.requirements, d.summary, c.name as company, c.industry, coalesce(d.country, c.country) as country
     from sales_deals d left join sales_companies c on c.id = d.company_id where d.id = $1`,
    [dealId],
  );
  if (!d) return null;
  let draft = {
    title: `${d.services?.[0] ?? "Project"} for ${d.company ?? d.title}`,
    problem: d.requirements?.slice(0, 600) ?? null,
    solution: d.services?.length ? `Delivered: ${d.services.join(", ")}.` : null,
    result: null as string | null,
  };
  if (llmConfigured()) {
    try {
      const ctx = await dealContext(dealId, { interactions: 20 });
      const out = await llmJson<{ title?: string; problem?: string; solution?: string; result?: string | null }>(
        `You write a short case study for a small AI agency, from the deal record only. Plain words, no hype, no dashes.
Return JSON {"title": 4 to 9 words, outcome first if known, "problem": 1 to 2 sentences on what was wrong before,
"solution": 1 to 2 sentences on what was built, "result": the measured result in one sentence ONLY if the record states a number or a concrete
outcome, otherwise null}. Never invent numbers, names or results.`,
        ctx.slice(0, 7000),
        { maxTokens: 500, totalMs: 30_000 },
      );
      draft = {
        title: String(out.title ?? "").trim() || draft.title,
        problem: String(out.problem ?? "").trim() || draft.problem,
        solution: String(out.solution ?? "").trim() || draft.solution,
        result: out.result ? String(out.result).trim() : null,
      };
    } catch {
      // keep the plain draft from the deal's own fields
    }
  }
  const row = await one<{ id: number }>(
    `insert into sales_proofs (deal_id, title, client, industry, country, services, problem, solution, result, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft') on conflict (deal_id) where deal_id is not null do nothing returning id`,
    [dealId, draft.title.slice(0, 200), d.company, d.industry, d.country, d.services ?? [], draft.problem, draft.solution, draft.result],
  );
  return row?.id ?? null;
}

export async function listProofs(): Promise<Proof[]> {
  return q<Proof>(
    `select p.*, d.title as deal_title from sales_proofs p left join sales_deals d on d.id = p.deal_id
     order by case p.status when 'draft' then 0 when 'approved' then 1 else 2 end, p.updated_at desc`,
  );
}

export async function saveProof(p: Partial<Proof> & { title: string }): Promise<number> {
  const title = p.title?.trim();
  if (!title) throw new UserError("Give the case study a title.");
  if (p.status === "approved" && !(p.problem?.trim() && p.solution?.trim())) throw new UserError("Add the problem and what you built before approving it.");
  const vals = [title.slice(0, 200), p.client?.trim() || null, p.industry?.trim() || null, p.country?.trim() || null, (p.services ?? []).map((s) => s.trim()).filter(Boolean),
    p.problem?.trim() || null, p.solution?.trim() || null, p.result?.trim() || null, p.link?.trim() || null, p.status ?? "draft"];
  if (p.id) {
    await q(
      `update sales_proofs set title = $2, client = $3, industry = $4, country = $5, services = $6, problem = $7, solution = $8, result = $9, link = $10, status = $11, updated_at = now() where id = $1`,
      [p.id, ...vals],
    );
    return p.id;
  }
  const row = await one<{ id: number }>(
    "insert into sales_proofs (title, client, industry, country, services, problem, solution, result, link, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
    vals,
  );
  return row!.id;
}

export async function deleteProof(id: number): Promise<void> {
  await q("delete from sales_proofs where id = $1", [id]);
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !["and", "the", "with", "services"].includes(w)));

/** Approved proof that fits a deal (shared service or industry words), best fit first, never the deal's own. */
export async function proofFor(dealId: number, limit = 2): Promise<Proof[]> {
  const d = await one<{ services: string[]; industry: string | null; requirements: string | null }>(
    "select d.services, c.industry, d.requirements from sales_deals d left join sales_companies c on c.id = d.company_id where d.id = $1",
    [dealId],
  );
  if (!d) return [];
  const want = words([...(d.services ?? []), d.industry ?? ""].join(" "));
  const proofs = await q<Proof>("select p.*, null as deal_title from sales_proofs p where p.status = 'approved' and (p.deal_id is null or p.deal_id <> $1)", [dealId]);
  return proofs
    .map((p) => ({ p, score: [...words([...p.services, p.industry ?? "", p.title].join(" "))].filter((w) => want.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

export function proofBlock(proofs: Proof[]): string {
  if (!proofs.length) return "";
  return `\nPROOF YOU MAY CITE (real, approved by the owner). Use at most one, in one short line, only if it fits this person; name the client only as written:\n${proofs
    .map((p) => `- ${p.title}${p.client ? ` (client: ${p.client}${p.industry ? `, ${p.industry}` : ""})` : ""}. Problem: ${p.problem ?? ""} Built: ${p.solution ?? ""}${p.result ? ` Result: ${p.result}` : ""}${p.link ? ` Link: ${p.link}` : ""}`)
    .join("\n")}`;
}
