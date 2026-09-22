import { q, one } from "@/lib/db";

export type RefKind = "link" | "note" | "quote";

export interface Ref {
  id: number;
  kind: RefKind;
  title: string;
  url: string | null;
  body: string | null;
  source: string | null;
  tags: string[];
  pinned: boolean;
  created_at: string;
}

export async function listRefs(): Promise<Ref[]> {
  return q<Ref>(
    "select * from refs order by pinned desc, created_at desc",
  );
}

export async function createRef(data: Omit<Ref, "id" | "created_at">) {
  const [row] = await q<{ id: number }>(
    `insert into refs (kind, title, url, body, source, tags, pinned)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [data.kind, data.title.trim(), data.url || null, data.body || null,
     data.source || null, data.tags, data.pinned],
  );
  return row.id;
}

export async function updateRef(id: number, data: Partial<Omit<Ref, "id" | "created_at">>) {
  const fields: string[] = [];
  const params: unknown[] = [id];
  let i = 2;
  for (const [k, v] of Object.entries(data)) {
    fields.push(`${k} = $${i++}`);
    params.push(v ?? null);
  }
  if (!fields.length) return;
  await q(`update refs set ${fields.join(", ")} where id = $1`, params);
}

export async function deleteRef(id: number) {
  await q("delete from refs where id = $1", [id]);
}

export async function allTags(): Promise<string[]> {
  const rows = await q<{ tag: string }>(
    "select distinct unnest(tags) as tag from refs order by 1",
  );
  return rows.map((r) => r.tag);
}
