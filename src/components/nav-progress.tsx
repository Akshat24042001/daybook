"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A thin accent bar at the top while a page is loading after a link click, so a tap always gets instant feedback.
 * Starts on same-site link clicks (or a "daybook:nav" event) and stops when the new route renders.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [active, setActive] = useState(false);

  useEffect(() => setActive(false), [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setActive(true);
    };
    const onNav = () => setActive(true);
    document.addEventListener("click", onClick);
    window.addEventListener("daybook:nav", onNav);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("daybook:nav", onNav);
    };
  }, []);

  // never stick around if a navigation is cancelled
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(false), 12_000);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-0.5" role="progressbar" aria-label="Loading page">
      <div className="nav-progress h-full w-full bg-accent shadow-[0_0_8px_hsl(var(--accent)/0.6)]" />
    </div>
  );
}
