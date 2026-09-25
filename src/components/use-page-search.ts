"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Page search box state that starts from ?q= (so search results can link straight to a filtered page) and gets
 * focus when "/" is pressed outside a text field.
 */
export function usePageSearch() {
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = params.get("q");
    if (q !== null) setQuery(q);
  }, [params]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || t.closest("input, textarea, select, [contenteditable=true], [role='combobox']")) return;
      if (document.querySelector("[role='dialog']")) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { query, setQuery, ref };
}
