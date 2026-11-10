/**
 * Errors that mean "this tab is running an older build than the server" (it happens right after a deploy):
 * a code chunk that no longer exists, or a server action id the new build does not know. Reloading fixes them.
 * Client-safe: no server imports.
 */
export function isStaleClientError(e: unknown): boolean {
  const msg = `${(e as { name?: string })?.name ?? ""} ${(e as { message?: string })?.message ?? String(e ?? "")}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to find Server Action|dynamically imported module|Importing a module script failed|unexpected response was received from the server|An unexpected response/i.test(msg);
}

const KEY = "daybook-stale-reload";

/** Reloads the page, at most once a minute, so a reload that does not help never loops. Returns false if it did not. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // no storage (private mode): still reload; the browser stops a true loop on its own
  }
  window.location.reload();
  return true;
}
