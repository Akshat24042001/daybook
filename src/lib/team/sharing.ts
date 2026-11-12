/**
 * The owner's controls: which salespeople a lead is shared with (and whether they see its value and research), and
 * which of them see each update. An update can only be shown to someone the lead is shared with.
 */
import { one, q, UserError } from "../db";

export interface DealShare {
  user_id: number;
  display_name: string;
  username: string;
  active: boolean;
  shared: boolean;
  show_value: boolean;
  show_research: boolean;
  added_it: boolean;
}

export async function dealShares(dealId: number): Promise<DealShare[]> {
  return q<DealShare>(
    `select u.id as user_id, u.display_name, u.username, u.active, (a.user_id is not null) as shared,
       coalesce(a.show_value, false) as show_value, coalesce(a.show_research, false) as show_research, (d.created_by_user = u.id) as added_it
     from sales_users u cross join (select created_by_user from sales_deals where id = $1) d
     left join sales_deal_access a on a.user_id = u.id and a.deal_id = $1
     order by u.active desc, lower(u.display_name)`,
    [dealId],
  );
}

export async function setDealShare(dealId: number, userId: number, o: { shared: boolean; show_value?: boolean; show_research?: boolean }): Promise<void> {
  if (!(await one("select 1 from sales_deals where id = $1", [dealId]))) throw new UserError("That lead no longer exists.");
  if (!(await one("select 1 from sales_users where id = $1", [userId]))) throw new UserError("That salesperson no longer exists.");
  if (!o.shared) {
    if (await one("select 1 from sales_deals where id = $1 and created_by_user = $2", [dealId, userId])) throw new UserError("They added this lead, so it stays with them. Switch their login off to stop all access.");
    await q("delete from sales_deal_access where deal_id = $1 and user_id = $2", [dealId, userId]);
    return;
  }
  await q(
    `insert into sales_deal_access (deal_id, user_id, show_value, show_research) values ($1,$2,coalesce($3,false),coalesce($4,false))
     on conflict (deal_id, user_id) do update set show_value = coalesce($3, sales_deal_access.show_value), show_research = coalesce($4, sales_deal_access.show_research)`,
    [dealId, userId, o.show_value ?? null, o.show_research ?? null],
  );
}

const TABLE = { interaction: "sales_interactions", commitment: "sales_commitments", capture: "sales_captures", doc: "sales_docs" } as const;
export type ItemKind = keyof typeof TABLE;

/** Who sees one update. Only people the lead is shared with; the one who made it always sees it. */
export async function setItemVisibility(kind: ItemKind, id: number, userIds: number[]): Promise<number[]> {
  const table = TABLE[kind];
  if (!table) throw new UserError("Unknown update.");
  const row = await one<{ deal_id: number | null; author_user: number | null }>(`select deal_id, author_user from ${table} where id = $1`, [id]);
  if (!row?.deal_id) throw new UserError("That update no longer exists.");
  const ids = [...new Set(userIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const ok = new Set((await q<{ user_id: number }>("select user_id from sales_deal_access where deal_id = $1 and user_id = any($2::int[])", [row.deal_id, ids])).map((r) => r.user_id));
  const outside = ids.filter((x) => !ok.has(x));
  if (outside.length) throw new UserError("Share the lead with them first.");
  const keep = ids.filter((x) => x !== row.author_user);
  await q(`update ${table} set shared_with = $2 where id = $1`, [id, keep]);
  return keep;
}

/** The people a lead is shared with, for the "Visible to" pickers. */
export async function dealAudience(dealId: number): Promise<{ id: number; name: string }[]> {
  return q("select u.id, u.display_name as name from sales_deal_access a join sales_users u on u.id = a.user_id where a.deal_id = $1 and u.active order by lower(u.display_name)", [dealId]);
}
