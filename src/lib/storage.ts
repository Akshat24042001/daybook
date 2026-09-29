/**
 * File storage for the scratchpad (photos, videos, voice memos, documents), on Supabase Storage.
 *
 * Files never pass through the app server (Vercel caps request bodies at 4.5 MB): the server hands the browser a
 * short-lived signed upload URL, the browser uploads straight to Supabase, and pages get short-lived signed download
 * URLs. The bucket is private; the service key stays on the server.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY). The bucket is created on first use.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "scratch";
/** Supabase's free plan allows files up to 50 MB. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface FileStore {
  signUpload(path: string): Promise<{ url: string }>;
  signDownloads(paths: string[], expiresSec: number): Promise<Map<string, string>>;
  info(path: string): Promise<{ size: number; mime: string | null } | null>;
  copy(from: string, to: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  download(path: string): Promise<{ data: ArrayBuffer; mime: string }>;
}

export class StorageNotConfigured extends Error {}

/**
 * The Supabase project's API address: SUPABASE_URL if set, otherwise worked out from DATABASE_URL, which already names
 * the project ("db.<ref>.supabase.co", or user "postgres.<ref>" on the pooler).
 */
export function supabaseUrl(): string | null {
  const explicit = process.env.SUPABASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const db = process.env.DATABASE_URL?.trim();
  if (!db) return null;
  try {
    const u = new URL(db);
    const direct = /^db\.([a-z0-9]{10,40})\.supabase\.co$/i.exec(u.hostname);
    const pooled = /pooler\.supabase\.com$/i.test(u.hostname) ? /^postgres\.([a-z0-9]{10,40})$/i.exec(decodeURIComponent(u.username)) : null;
    const ref = direct?.[1] ?? pooled?.[1];
    return ref ? `https://${ref.toLowerCase()}.supabase.co` : null;
  } catch {
    return null;
  }
}

const secretKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)?.trim() || null;

function supabaseStore(): FileStore {
  const url = supabaseUrl();
  const key = secretKey();
  if (!url || !key) throw new StorageNotConfigured("File storage is not set up: add SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_URL if your database is not on Supabase).");
  const client: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const files = () => client.storage.from(BUCKET);

  let ready: Promise<void> | null = null;
  const ensureBucket = () => {
    ready ??= (async () => {
      const got = await client.storage.getBucket(BUCKET);
      if (!got.error) return;
      const made = await client.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_FILE_BYTES });
      if (made.error && !/already exists/i.test(made.error.message)) throw new Error(`Could not create the storage bucket: ${made.error.message}`);
    })().catch((e) => {
      ready = null;
      throw e;
    });
    return ready;
  };
  const fail = (what: string, e: { message: string } | null) => {
    if (e) throw new Error(`Storage ${what} failed: ${e.message}`);
  };

  return {
    async signUpload(path) {
      await ensureBucket();
      const { data, error } = await files().createSignedUploadUrl(path);
      fail("upload link", error);
      return { url: data!.signedUrl };
    },
    async signDownloads(paths, expiresSec) {
      const out = new Map<string, string>();
      if (!paths.length) return out;
      await ensureBucket();
      const { data, error } = await files().createSignedUrls(paths, expiresSec);
      fail("download links", error);
      for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
      return out;
    },
    async info(path) {
      await ensureBucket();
      const { data, error } = await files().info(path);
      if (error || !data) return null;
      const d = data as { size?: number; contentType?: string; metadata?: { size?: number; mimetype?: string } };
      return { size: d.size ?? d.metadata?.size ?? 0, mime: d.contentType ?? d.metadata?.mimetype ?? null };
    },
    async copy(from, to) {
      await ensureBucket();
      const { error } = await files().copy(from, to);
      fail("copy", error);
    },
    async remove(paths) {
      if (!paths.length) return;
      await ensureBucket();
      const { error } = await files().remove(paths);
      fail("delete", error);
    },
    async download(path) {
      await ensureBucket();
      const { data, error } = await files().download(path);
      fail("download", error);
      return { data: await data!.arrayBuffer(), mime: data!.type || "application/octet-stream" };
    },
  };
}

let override: FileStore | null = null;
let cached: FileStore | null = null;

export function storageConfigured(): boolean {
  if (override) return true;
  return !!(supabaseUrl() && secretKey());
}

export function fileStore(): FileStore {
  if (override) return override;
  cached ??= supabaseStore();
  return cached;
}

/** Tests only: an in-memory store. */
export function useMemoryStore(): Map<string, { data: Uint8Array; mime: string }> {
  const mem = new Map<string, { data: Uint8Array; mime: string }>();
  override = {
    async signUpload(path) { return { url: `memory://upload/${path}` }; },
    async signDownloads(paths) { return new Map(paths.filter((p) => mem.has(p)).map((p) => [p, `memory://get/${p}`])); },
    async info(path) { const f = mem.get(path); return f ? { size: f.data.byteLength, mime: f.mime } : null; },
    async copy(from, to) { const f = mem.get(from); if (!f) throw new Error("not found"); mem.set(to, f); },
    async remove(paths) { for (const p of paths) mem.delete(p); },
    async download(path) { const f = mem.get(path); if (!f) throw new Error("not found"); return { data: f.data.slice().buffer, mime: f.mime }; },
  };
  return mem;
}

export function resetStore(): void {
  override = null;
  cached = null;
}

/** A storage path for a new file: dated folder, random prefix, a safe version of the original name. */
export function newPath(date: string, name: string): string {
  const safe = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(-80) || "file";
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${date}/${rand}-${safe}`;
}
