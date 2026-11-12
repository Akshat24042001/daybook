/**
 * The screenshots you share (in the capture box or on Telegram), kept with the deal they were filed to.
 * The image moves to file storage when it is set up; until then it stays in the database. Either way the deal page
 * shows it, and the AI can read it again.
 */
import { one, q } from "../db";
import { fileStore, newPath, storageConfigured } from "../storage";

export interface Shot {
  capture_id: number;
  index: number;
  at: string;
  summary: string | null;
  source: string;
  author_user?: number | null;
  author_name?: string | null;
  shared_with?: number[];
}

const parseDataUrl = (u: string): { mime: string; data: Uint8Array } | null => {
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(u);
  return m ? { mime: m[1], data: Uint8Array.from(Buffer.from(m[2], "base64")) } : null;
};

/** Links a capture to its deal and moves its images to file storage. Never throws: the log matters more. */
export async function keepShots(captureId: number, dealId: number | null): Promise<void> {
  try {
    await q("update sales_captures set deal_id = $2 where id = $1", [captureId, dealId]);
    if (!storageConfigured()) return;
    const cap = await one<{ images: string[]; image_paths: string[]; created_at: string }>("select images, image_paths, created_at from sales_captures where id = $1", [captureId]);
    if (!cap?.images?.length || cap.image_paths?.length) return;
    const day = new Date(cap.created_at).toISOString().slice(0, 10);
    const paths: string[] = [];
    for (const [i, u] of cap.images.entries()) {
      const f = parseDataUrl(u);
      if (!f) continue;
      const path = newPath(day, `sales-shot-${captureId}-${i + 1}.${f.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg"}`);
      await fileStore().upload(path, f.data, f.mime);
      paths.push(path);
    }
    // once every image is in storage, the database copy is dropped (it is the bulky part)
    if (paths.length === cap.images.length) await q("update sales_captures set image_paths = $2, images = '[]'::jsonb where id = $1", [captureId, paths]);
  } catch (e) {
    console.warn("[sales] screenshot not moved to storage, kept in the database:", (e as Error).message);
  }
}

/** The images of a capture as data URLs (from the database, or downloaded back from storage), for the AI. */
export async function shotDataUrls(cap: { images: string[] | null; image_paths?: string[] | null }): Promise<string[]> {
  if (cap.images?.length) return cap.images;
  const out: string[] = [];
  for (const p of cap.image_paths ?? []) {
    const f = await fileStore().download(p);
    out.push(`data:${f.mime};base64,${Buffer.from(f.data).toString("base64")}`);
  }
  return out;
}

/** Every screenshot filed to a deal, newest first. */
export async function dealShots(dealId: number): Promise<Shot[]> {
  const rows = await q<{ id: number; n: number; at: string; summary: string | null; source: string; author_user: number | null; author_name: string | null; shared_with: number[] }>(
    `select c.id, greatest(jsonb_array_length(coalesce(c.images, '[]'::jsonb)), cardinality(c.image_paths)) as n, c.created_at as at,
            c.result->>'summary' as summary, c.source, c.author_user, u.display_name as author_name, c.shared_with
     from sales_captures c left join sales_users u on u.id = c.author_user where c.deal_id = $1 and c.status <> 'ignored' order by c.created_at desc limit 60`,
    [dealId],
  );
  return rows.flatMap((r) => Array.from({ length: r.n }, (_, index) => ({ capture_id: r.id, index, at: r.at, summary: r.summary, source: r.source, author_user: r.author_user, author_name: r.author_name, shared_with: r.shared_with })));
}

/** One image, for the page: a short-lived storage link, or the bytes from the database. */
export async function shotFile(captureId: number, index: number): Promise<{ redirect: string } | { mime: string; data: Uint8Array } | null> {
  const cap = await one<{ images: string[]; image_paths: string[] }>("select images, image_paths from sales_captures where id = $1", [captureId]);
  if (!cap) return null;
  const path = cap.image_paths?.[index];
  if (path) {
    const u = (await fileStore().signDownloads([path], 600)).get(path);
    return u ? { redirect: u } : null;
  }
  const u = cap.images?.[index];
  return u ? parseDataUrl(u) : null;
}
