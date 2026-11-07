/**
 * The offer catalogue: what you sell, in one place, with ready-made packages a quote can start from.
 *
 * Once the catalogue has an offer, it is the single source of truth for "what you sell": drafts, radar scoring and the
 * research all read it (salesConfig().offers is built from it). Until then the plain list in Sales settings is used,
 * and opening the catalogue the first time copies that list in.
 */
import { one, q, tx, UserError } from "../db";

export interface PackageItem { name: string; description: string; qty: number; unit_price: number }
export interface Package {
  name: string;
  currency: string;
  items: PackageItem[];
  scope: string;
  timeline: string;
}
export interface Offer {
  id: number;
  name: string;
  summary: string | null;
  keywords: string[];
  packages: Package[];
  active: boolean;
  sort: number;
}

export async function listOffers(o: { activeOnly?: boolean; seedFrom?: string[] } = {}): Promise<Offer[]> {
  if (o.seedFrom?.length) {
    // one-time copy of the old plain list; the lock makes two page loads at once copy it only once
    // ...and only ever once: if you later delete every offer, the catalogue stays empty
    await tx(async (db) => {
      await db.query("select pg_advisory_xact_lock(hashtext('sales_offers_seed'))");
      const done = (await db.query<{ done: boolean }>("select coalesce((config->>'offers_seeded')::boolean, false) as done from sales_settings where id = 1")).rows[0]?.done;
      const n = (await db.query<{ n: number }>("select count(*)::int as n from sales_offers")).rows[0]?.n ?? 0;
      if (!done && !n) {
        for (const [i, name] of o.seedFrom!.entries()) await db.query("insert into sales_offers (name, sort) values ($1,$2)", [name.slice(0, 200), (i + 1) * 10]);
      }
      if (!done) await db.query("update sales_settings set config = coalesce(config, '{}'::jsonb) || '{\"offers_seeded\": true}'::jsonb where id = 1");
    });
  }
  return q<Offer>(`select id, name, summary, keywords, packages, active, sort from sales_offers ${o.activeOnly ? "where active" : ""} order by sort, id`);
}

/** Prompt lines for the AI: "Name: one-line summary". Empty when the catalogue is empty. */
export async function offerLines(): Promise<string[]> {
  const rows = await q<{ name: string; summary: string | null }>("select name, summary from sales_offers where active order by sort, id").catch(() => []);
  return rows.map((r) => (r.summary?.trim() ? `${r.name}: ${r.summary.trim()}` : r.name));
}

function cleanPackages(p: unknown): Package[] {
  if (!Array.isArray(p)) return [];
  return p.slice(0, 12).map((x) => {
    const k = (x ?? {}) as Partial<Package>;
    const items = Array.isArray(k.items) ? k.items : [];
    return {
      name: String(k.name ?? "").trim().slice(0, 120) || "Package",
      currency: String(k.currency ?? "USD").toUpperCase().slice(0, 3),
      items: items.slice(0, 30).map((it) => ({
        name: String(it?.name ?? "").trim().slice(0, 200), description: String(it?.description ?? "").slice(0, 1000),
        qty: Math.max(0, Number(it?.qty) || 1), unit_price: Math.max(0, Number(it?.unit_price) || 0),
      })).filter((it) => it.name),
      scope: String(k.scope ?? "").slice(0, 5000),
      timeline: String(k.timeline ?? "").slice(0, 500),
    };
  });
}

export function packageTotal(p: Package): number {
  return p.items.reduce((a, i) => a + i.qty * i.unit_price, 0);
}

export async function saveOffer(o: { id?: number; name: string; summary?: string | null; keywords?: string[]; packages?: unknown; active?: boolean; sort?: number }): Promise<number> {
  const name = o.name?.trim();
  if (!name) throw new UserError("Give the offer a name.");
  const keywords = [...new Set((o.keywords ?? []).map((k) => k.trim()).filter(Boolean))].slice(0, 20);
  const packages = JSON.stringify(cleanPackages(o.packages ?? []));
  if (o.id) {
    await q(
      "update sales_offers set name = $2, summary = $3, keywords = $4, packages = $5, active = coalesce($6, active), sort = coalesce($7, sort), updated_at = now() where id = $1",
      [o.id, name, o.summary?.trim() || null, keywords, packages, o.active ?? null, o.sort ?? null],
    );
    return o.id;
  }
  const row = await one<{ id: number }>(
    "insert into sales_offers (name, summary, keywords, packages, active, sort) values ($1,$2,$3,$4,coalesce($5,true),coalesce($6,(select coalesce(max(sort),0)+10 from sales_offers))) returning id",
    [name, o.summary?.trim() || null, keywords, packages, o.active ?? null, o.sort ?? null],
  );
  return row!.id;
}

export async function deleteOffer(id: number): Promise<void> {
  await q("delete from sales_offers where id = $1", [id]);
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));

/** Does a service name on a deal ("AI agents") belong to this offer (by name or keyword)? */
export function offerCovers(o: Pick<Offer, "name" | "keywords">, service: string): boolean {
  const s = service.toLowerCase().trim();
  if (!s) return false;
  if (o.keywords.some((k) => k.toLowerCase().trim() === s) || o.name.toLowerCase().includes(s) || s.includes(o.name.toLowerCase())) return true;
  const a = words(o.name + " " + o.keywords.join(" "));
  const b = [...words(s)];
  return b.length > 0 && b.filter((w) => a.has(w)).length >= Math.ceil(b.length / 2);
}

/** Offers this client has not bought yet: the catalogue minus what their deals were about. */
export function notBought(offers: Offer[], services: string[]): Offer[] {
  return offers.filter((o) => o.active && !services.some((s) => offerCovers(o, s)));
}

/** Packages that fit a deal's services first, then the rest. */
export function packagesFor(offers: Offer[], services: string[]): { offer: Offer; index: number; pkg: Package; fits: boolean }[] {
  const all = offers.filter((o) => o.active).flatMap((offer) => offer.packages.map((pkg, index) => ({ offer, index, pkg, fits: services.some((s) => offerCovers(offer, s)) })));
  return all.sort((a, b) => Number(b.fits) - Number(a.fits));
}
