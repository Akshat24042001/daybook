/**
 * Your own order inside a stage column. You drag a card above another; the cards from the top of the column down to
 * where you dropped it are saved in that order. Everything below keeps following the automatic priority.
 */
import { q, UserError } from "../db";

/** ids: the top of one stage's column, first one highest. Deals in other stages are ignored. */
export async function setManualOrder(stageId: number, ids: number[]): Promise<void> {
  const list = [...new Set(ids.map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 500);
  if (!list.length) throw new UserError("Nothing to order.");
  await q(
    `update sales_deals d set manual_rank = v.ord
     from unnest($2::int[]) with ordinality as v(id, ord)
     where d.id = v.id and d.stage_id = $1 and d.manual_rank is distinct from v.ord`,
    [stageId, list],
  );
}

/** Back to automatic order: for one stage, or every stage. Returns how many deals were reset. */
export async function resetManualOrder(stageId?: number | null): Promise<number> {
  const rows = await q<{ id: number }>(
    "update sales_deals set manual_rank = null where manual_rank is not null and ($1::int is null or stage_id = $1) returning id",
    [stageId ?? null],
  );
  return rows.length;
}
