"use client";

import { Copy } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { fmtNum, runTape } from "@/lib/calc";
import { cn } from "@/lib/cn";
import type { CalcData } from "@/lib/scratch";
import { useToast } from "../toast";

// phone keyboards hide these; one tap inserts at the caret of the focused line
const KEYS = ["+", "−", "×", "÷", "^", "(", ")", "%", "√", "π", "="];
const KEY_TEXT: Record<string, string> = { "−": "-", "×": "*", "÷": "/", "√": "sqrt(", "π": "pi", "=": " = " };

export function CalcTape({ data, onChange, autoFocus }: { data: CalcData; onChange: (d: CalcData) => void; autoFocus?: boolean }) {
  const { toast } = useToast();
  const lines = data.lines;
  const results = useMemo(() => runTape(lines), [lines]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const lastFocus = useRef(0);

  const set = (next: string[]) => onChange({ lines: next.length ? next : [""] });
  // lines come back from the parent a render later, so move the caret once they are on screen
  const focusReq = useRef<{ i: number; at?: number } | null>(null);
  const focus = (i: number, at?: number, afterRender = true) => {
    focusReq.current = { i, at };
    if (!afterRender) applyFocus();
  };
  const applyFocus = () => {
    const req = focusReq.current;
    const el = req && refs.current[req.i];
    if (!req || !el) return;
    focusReq.current = null;
    el.focus();
    const pos = Math.min(req.at ?? el.value.length, el.value.length);
    el.setSelectionRange(pos, pos);
  };
  useLayoutEffect(applyFocus);

  const total = results.reduce((s, r) => (r.kind === "value" && !r.name ? s + r.value : s), 0);
  const counted = results.filter((r) => r.kind === "value" && !r.name).length;

  const insertKey = (k: string) => {
    const i = Math.min(lastFocus.current, lines.length - 1);
    const el = refs.current[i];
    const text = KEY_TEXT[k] ?? k;
    const start = el?.selectionStart ?? lines[i].length;
    const end = el?.selectionEnd ?? start;
    set(lines.map((l, j) => (j === i ? l.slice(0, start) + text + l.slice(end) : l)));
    focus(i, start + text.length);
  };

  const copy = (v: number) => {
    const text = String(Number(v.toPrecision(12)));
    void navigator.clipboard?.writeText(text).then(() => toast(`Copied ${text}`), () => undefined);
  };

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-border font-mono text-sm">
        {lines.map((line, i) => {
          const r = results[i];
          return (
            <div key={i} className={cn("flex items-center gap-2 border-b border-border/60 px-2 last:border-b-0", r.kind === "comment" && "bg-muted/40")}>
              <span className="w-5 shrink-0 select-none text-right text-[10px] text-subtle/70">{i + 1}</span>
              <input
                ref={(el) => { refs.current[i] = el; }}
                value={line}
                autoFocus={autoFocus && i === 0}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                inputMode="text"
                aria-label={`Line ${i + 1}`}
                placeholder={i === 0 && lines.length === 1 ? "e.g. rent = 18000, then rent * 12 or 18% of 2400" : ""}
                onFocus={() => (lastFocus.current = i)}
                onChange={(e) => set(lines.map((l, j) => (j === i ? e.target.value : l)))}
                onKeyDown={(e) => {
                  const el = e.currentTarget;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const pos = el.selectionStart ?? line.length;
                    set([...lines.slice(0, i), line.slice(0, pos), line.slice(pos), ...lines.slice(i + 1)]);
                    focus(i + 1, 0);
                  } else if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0 && i > 0) {
                    e.preventDefault();
                    const prev = lines[i - 1];
                    set([...lines.slice(0, i - 1), prev + line, ...lines.slice(i + 1)]);
                    focus(i - 1, prev.length);
                  } else if (e.key === "ArrowUp" && i > 0) {
                    e.preventDefault();
                    focus(i - 1, undefined, false);
                  } else if (e.key === "ArrowDown" && i < lines.length - 1) {
                    e.preventDefault();
                    focus(i + 1, undefined, false);
                  }
                }}
                className={cn("h-9 min-w-0 flex-1 bg-transparent outline-none placeholder:font-sans placeholder:text-subtle/60", r.kind === "comment" && "text-subtle")}
              />
              {r.kind === "value" ? (
                <button
                  onClick={() => copy(r.value)}
                  title="Copy"
                  className="group flex max-w-[45%] shrink-0 items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-right tabular-nums text-accent hover:bg-accent-muted"
                >
                  {r.name ? <span className="text-subtle">{r.name} =</span> : <span className="text-subtle">=</span>}
                  <span className="truncate font-semibold">{fmtNum(r.value)}</span>
                  <Copy className="hidden h-3 w-3 opacity-60 group-hover:block" />
                </button>
              ) : r.kind === "error" && line.trim() ? (
                <span className="max-w-[45%] shrink-0 truncate font-sans text-xs text-bad/80" title={r.error}>{r.error}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {KEYS.map((k) => (
          <button
            key={k}
            onPointerDown={(e) => e.preventDefault() /* keep the caret in the line */}
            onClick={() => insertKey(k)}
            className="h-8 min-w-[2rem] rounded-lg border border-border bg-surface px-2 font-mono text-sm hover:bg-muted"
          >
            {k}
          </button>
        ))}
        {counted > 1 ? (
          <button
            onClick={() => copy(total)}
            title="Sum of every result that is not a named variable. Click to copy."
            className="ml-auto rounded-lg bg-accent-muted px-2.5 py-1 font-mono text-sm text-accent"
          >
            Σ {fmtNum(total)}
          </button>
        ) : null}
      </div>
      <p className="text-[11px] leading-relaxed text-subtle">
        One sum per line. Name things (<code>rent = 18000</code>) and reuse them below; <code>ans</code> is the line above;
        {" "}<code>#</code> starts a comment. Understands <code>18% of 2400</code>, <code>2400 + 10%</code>, <code>2^10</code>, <code>5!</code>,
        {" "}<code>sqrt</code>, <code>sin(30deg)</code>, <code>round(x, 2)</code>, <code>7 mod 3</code>.
      </p>
    </div>
  );
}
