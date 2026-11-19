"use client";
/**
 * Background refreshes (a page checking for finished research every few seconds) must never swallow a click: a refresh
 * that lands while a link is opening can cancel the navigation. So a refresh is skipped for a few seconds after any
 * link is pressed, and while the tab is hidden.
 */
let lastLinkAt = 0;
let listening = false;

function listen(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("pointerdown", (e) => {
    if ((e.target as Element | null)?.closest?.("a[href]")) lastLinkAt = Date.now();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target as Element | null)?.closest?.("a[href]")) lastLinkAt = Date.now();
  }, true);
}

export function safeRefresh(router: { refresh: () => void }): void {
  listen();
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (Date.now() - lastLinkAt < 8_000) return;
  router.refresh();
}

/** Call once on a page that refreshes itself, so link presses are noticed from the start. */
export function watchLinks(): void {
  listen();
}
