/**
 * Pipelines and team.
 *
 * A pipeline is a named lane of deals (Projects, Retainers, Partnerships...) with the stages it shows. The stages and
 * their automation are shared, so a deal is moved, chased and closed the same way in every pipeline; a pipeline only
 * decides which deals and which columns you see together. Deals with no pipeline belong to the first one.
 *
 * The team is the people you work with (a partner, a freelancer, a sales hire). A deal can have an owner from it, so the
 * list can be filtered by who handles what. Daybook still has one login: team members do not sign in.
 */
import { one, q, UserError } from "../db";

export interface Pipeline { id: number; name: string; stage_ids: number[]; sort: number; active: boolean; deals?: number }
export interface TeamMember { id: number; name: string; email: string | null; phone: string | null; role: string | null; active: boolean; deals?: number }

export async function listPipelines(includeInactive = false): Promise<Pipeline[]> {
  return q<Pipeline>(
    `select p.id, p.name, p.stage_ids, p.sort, p.active,
            (select count(*)::int from sales_deals d where coalesce(d.pipeline_id, (select min(id) from sales_pipelines)) = p.id) as deals
     from sales_pipelines p where $1 or p.active order by p.sort, p.id`,
    [includeInactive],
  ).catch(() => []);
}

export async function defaultPipelineId(): Promise<number | null> {
  return (await one<{ id: number }>("select id from sales_pipelines where active order by sort, id limit 1"))?.id ?? null;
}

export async function savePipeline(p: { id?: number; name: string; stage_ids?: number[]; active?: boolean }): Promise<number> {
  const name = p.name?.trim();
  if (!name) throw new UserError("Give the pipeline a name.");
  const stages = [...new Set((p.stage_ids ?? []).map(Number).filter(Number.isInteger))];
  if (stages.length) {
    const n = (await one<{ n: number }>("select count(*)::int as n from sales_stages where id = any($1::int[])", [stages]))!.n;
    if (n !== stages.length) throw new UserError("One of those stages no longer exists.");
  }
  if (p.id) {
    if (p.active === false) {
      const others = (await one<{ n: number }>("select count(*)::int as n from sales_pipelines where active and id <> $1", [p.id]))!.n;
      if (!others) throw new UserError("Keep at least one pipeline active.");
    }
    await q("update sales_pipelines set name = $2, stage_ids = $3, active = coalesce($4, active) where id = $1", [p.id, name.slice(0, 80), stages, p.active ?? null]);
    if (p.active === false) {
      // its deals move to the first active pipeline, so nothing disappears
      await q("update sales_deals set pipeline_id = (select id from sales_pipelines where active order by sort, id limit 1) where pipeline_id = $1", [p.id]);
    }
    return p.id;
  }
  const row = await one<{ id: number }>(
    "insert into sales_pipelines (name, stage_ids, sort) values ($1,$2,(select coalesce(max(sort),0)+10 from sales_pipelines)) returning id",
    [name.slice(0, 80), stages],
  );
  return row!.id;
}

export async function listTeam(includeInactive = false): Promise<TeamMember[]> {
  return q<TeamMember>(
    "select t.id, t.name, t.email, t.phone, t.role, t.active, (select count(*)::int from sales_deals d where d.owner_id = t.id) as deals from sales_team t where $1 or t.active order by t.name",
    [includeInactive],
  ).catch(() => []);
}

export async function saveMember(m: { id?: number; name: string; email?: string | null; phone?: string | null; role?: string | null; active?: boolean }): Promise<number> {
  const name = m.name?.trim();
  if (!name) throw new UserError("Give them a name.");
  const email = m.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("That email address does not look right.");
  const vals = [name.slice(0, 120), email, m.phone?.trim() || null, m.role?.trim() || null];
  if (m.id) {
    await q("update sales_team set name = $2, email = $3, phone = $4, role = $5, active = coalesce($6, active) where id = $1", [m.id, ...vals, m.active ?? null]);
    return m.id;
  }
  return (await one<{ id: number }>("insert into sales_team (name, email, phone, role) values ($1,$2,$3,$4) returning id", vals))!.id;
}
