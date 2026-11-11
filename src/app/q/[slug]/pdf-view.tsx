"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shows a PDF right on the page, every page stacked, sharp on any screen. Phones (Android Chrome above all) do not
 * show PDFs inside a page on their own, so it is drawn with pdf.js; if that fails, the browser's own viewer is used.
 */
export function PdfView({ src, title }: { src: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "fallback">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const pdf = await pdfjs.getDocument({ url: src }).promise;
        const el = box.current;
        if (!el || cancelled) return;
        el.innerHTML = "";
        const width = el.clientWidth || 800;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= Math.min(pdf.numPages, 60); n++) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (width / base.width) * dpr });
          const c = document.createElement("canvas");
          c.width = Math.floor(vp.width);
          c.height = Math.floor(vp.height);
          c.style.width = "100%";
          c.setAttribute("aria-label", `${title}, page ${n} of ${pdf.numPages}`);
          c.setAttribute("role", "img");
          el.appendChild(c);
          await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
          if (n === 1) setState("ok");
        }
      } catch (e) {
        console.warn("[pdf] could not draw it here, using the browser viewer:", (e as Error).message);
        if (!cancelled) setState("fallback");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, title]);

  if (state === "fallback") return <iframe className="qview" src={`${src}#view=FitH`} title={title} />;
  return (
    <div className="qpdf" aria-busy={state === "loading"}>
      {state === "loading" ? <p className="qnote">Loading the document…</p> : null}
      <div ref={box} className="qpages" />
    </div>
  );
}
