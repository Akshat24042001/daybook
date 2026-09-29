"use client";

import { Check, Copy, ExternalLink, GripVertical, Minus, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CODE_LANGS, TABLE_MAX_COLS, TABLE_MAX_ROWS, type ChecklistData, type CodeData, type LinkData, type TableData } from "@/lib/scratch";
import { colName, evaluateSheet, showCell } from "@/lib/sheet";
import { useToast } from "../toast";

const box = "rounded-xl border border-border bg-surface outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20";
const newId = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- checklist

export function ChecklistEditor({ data, onChange, autoFocus }: { data: ChecklistData; onChange: (d: ChecklistData) => void; autoFocus: boolean }) {
  const [draft, setDraft] = useState("");
  const refs = useRef(new Map<string, HTMLInputElement>());
  const items = data.items;
  const done = items.filter((i) => i.done).length;
  const set = (next: ChecklistData["items"]) => onChange({ items: next });
  const drag = useRef<number | null>(null);
  // a new row exists only after the next render: focus it then, so no keystroke goes to the old row
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    refs.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  }, [items]);

  const add = (text: string, at = items.length) => {
    const lines = text.split("\n").map((l) => l.replace(/^\s*[-*•]\s*(\[.?\]\s*)?/, "").trim()).filter(Boolean);
    if (!lines.length) return;
    set([...items.slice(0, at), ...lines.map((t) => ({ id: newId(), text: t, done: false })), ...items.slice(at)]);
  };

  return (
    <div className="space-y-2">
      {items.length ? (
        <div className="flex items-center gap-2 text-xs text-subtle">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-good transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <span className="tabular-nums">{done}/{items.length}</span>
          {done ? (
            <button className="hover:text-fg" onClick={() => set(items.filter((i) => !i.done))} title="Remove ticked items">Clear done</button>
          ) : null}
        </div>
      ) : null}
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li
            key={it.id}
            className="group flex items-center gap-2 rounded-lg px-1 hover:bg-muted/50"
            draggable
            onDragStart={() => (drag.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const from = drag.current;
              drag.current = null;
              if (from === null || from === i) return;
              const next = [...items];
              const [moved] = next.splice(from, 1);
              next.splice(i, 0, moved);
              set(next);
            }}
          >
            <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-subtle/50 opacity-0 group-hover:opacity-100" />
            <button
              onClick={() => set(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
              className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", it.done ? "border-good bg-good text-white" : "border-border hover:border-accent")}
              aria-label={it.done ? "Untick" : "Tick"}
            >
              {it.done ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
            <input
              ref={(el) => { if (el) refs.current.set(it.id, el); else refs.current.delete(it.id); }}
              value={it.text}
              onChange={(e) => set(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const id = newId();
                  focusNext.current = id;
                  set([...items.slice(0, i + 1), { id, text: "", done: false }, ...items.slice(i + 1)]);
                } else if (e.key === "Backspace" && !it.text) {
                  e.preventDefault();
                  set(items.filter((x) => x.id !== it.id));
                  const prev = items[i - 1];
                  if (prev) refs.current.get(prev.id)?.focus();
                }
              }}
              className={cn("h-8 min-w-0 flex-1 bg-transparent text-sm outline-none", it.done && "text-subtle line-through")}
            />
            <button onClick={() => set(items.filter((x) => x.id !== it.id))} className="text-subtle opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Remove">
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
          setDraft("");
        }}
        className="flex items-center gap-2"
      >
        <Plus className="h-4 w-4 shrink-0 text-subtle" />
        <input
          autoFocus={autoFocus}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text.includes("\n")) {
              e.preventDefault();
              add(text);
            }
          }}
          placeholder="Add an item (paste a list to add many)"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle/60"
        />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- table

export function TableEditor({ data, onChange }: { data: TableData; onChange: (d: TableData) => void }) {
  const rows = data.rows;
  const cols = rows[0]?.length ?? 1;
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const values = useMemo(() => evaluateSheet(rows), [rows]);
  const refs = useRef(new Map<string, HTMLInputElement>());
  const set = (r: number, c: number, v: string) => onChange({ rows: rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  // the target cell already exists, so move at once (a frame later, fast typing lands in the old cell)
  const go = (r: number, c: number) => refs.current.get(`${r}:${c}`)?.focus();
  const btn = "flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-xs text-subtle hover:bg-muted hover:text-fg disabled:opacity-40";
  const focused = focus ? rows[focus[0]]?.[focus[1]] ?? "" : "";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-[3rem] rounded-md bg-muted px-1.5 py-0.5 text-center font-mono text-xs">{focus ? `${colName(focus[1])}${focus[0] + 1}` : "–"}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-subtle">{focused.startsWith("=") ? focused : ""}</span>
        <button className={btn} disabled={rows.length >= TABLE_MAX_ROWS} onClick={() => onChange({ rows: [...rows, Array(cols).fill("")] })}><Plus className="h-3 w-3" /> Row</button>
        <button className={btn} disabled={rows.length <= 1} onClick={() => onChange({ rows: rows.slice(0, -1) })}><Minus className="h-3 w-3" /> Row</button>
        <button className={btn} disabled={cols >= TABLE_MAX_COLS} onClick={() => onChange({ rows: rows.map((r) => [...r, ""]) })}><Plus className="h-3 w-3" /> Column</button>
        <button className={btn} disabled={cols <= 1} onClick={() => onChange({ rows: rows.map((r) => r.slice(0, -1)) })}><Minus className="h-3 w-3" /> Column</button>
      </div>
      <div className="overflow-auto rounded-xl border border-border">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 w-8 bg-muted" />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className="min-w-[6.5rem] border-l border-border bg-muted px-2 py-0.5 text-center text-[11px] font-medium text-subtle">{colName(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-t border-border">
                <td className="sticky left-0 bg-muted px-1.5 text-center text-[11px] tabular-nums text-subtle">{r + 1}</td>
                {row.map((raw, c) => {
                  const v = values[r]?.[c];
                  const isFocus = focus?.[0] === r && focus?.[1] === c;
                  const shown = isFocus ? raw : v ? showCell(v) : raw;
                  return (
                    <td key={c} className="border-l border-border p-0">
                      <input
                        ref={(el) => { if (el) refs.current.set(`${r}:${c}`, el); else refs.current.delete(`${r}:${c}`); }}
                        value={shown}
                        onFocus={() => setFocus([r, c])}
                        onBlur={() => setFocus((f) => (f && f[0] === r && f[1] === c ? null : f))}
                        onChange={(e) => set(r, c, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); go(Math.min(rows.length - 1, r + (e.shiftKey ? -1 : 1)), c); }
                          else if (e.key === "ArrowDown") { e.preventDefault(); go(Math.min(rows.length - 1, r + 1), c); }
                          else if (e.key === "ArrowUp") { e.preventDefault(); go(Math.max(0, r - 1), c); }
                        }}
                        className={cn(
                          "h-8 w-full min-w-[6.5rem] bg-transparent px-2 outline-none focus:bg-accent-muted/40 focus:ring-2 focus:ring-inset focus:ring-accent/50",
                          v?.kind === "number" && !isFocus && "text-right tabular-nums",
                          v?.kind === "error" && !isFocus && "text-bad",
                          raw.startsWith("=") && !isFocus && v?.kind !== "error" && "font-medium text-accent",
                        )}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-subtle">
        Start a cell with <code>=</code> for a formula: <code>=A1+B1</code>, <code>=B2*18%</code>, <code>=SUM(A1:A10)</code>, <code>=AVG(B2:B8)</code>,
        {" "}<code>=MAX(…)</code>, <code>=COUNT(…)</code>, <code>=ROUND(C4, 2)</code>.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- link

export function LinkEditor({ data, onChange, autoFocus }: { data: LinkData; onChange: (d: LinkData) => void; autoFocus: boolean }) {
  let host = "";
  try { host = data.url ? new URL(/^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }
  const href = data.url && host ? (/^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`) : null;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          autoFocus={autoFocus}
          value={data.url}
          onChange={(e) => onChange({ ...data, url: e.target.value })}
          placeholder="Paste a link"
          inputMode="url"
          className={cn(box, "h-10 min-w-0 flex-1 px-3 text-sm")}
        />
        {href ? (
          <a href={href} target="_blank" rel="noreferrer noopener" className="flex h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-sm hover:bg-muted">
            <ExternalLink className="h-4 w-4" /> Open
          </a>
        ) : null}
      </div>
      {host ? <p className="text-xs text-subtle">{host}</p> : null}
      <textarea
        value={data.note}
        onChange={(e) => onChange({ ...data, note: e.target.value })}
        placeholder="Why it matters, what to do with it"
        className={cn(box, "min-h-[72px] w-full resize-y px-3 py-2 text-sm")}
      />
    </div>
  );
}

// ---------------------------------------------------------------- code

export function CodeEditor({ data, onChange, autoFocus }: { data: CodeData; onChange: (d: CodeData) => void; autoFocus: boolean }) {
  const { toast } = useToast();
  const lines = Math.max(6, Math.min(40, data.code.split("\n").length + 1));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select value={data.lang} onChange={(e) => onChange({ ...data, lang: e.target.value })} className={cn(box, "h-8 px-2 text-xs")} aria-label="Language">
          {CODE_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <span className="flex-1" />
        <button
          onClick={() => navigator.clipboard?.writeText(data.code).then(() => toast("Copied."), () => undefined)}
          className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs text-subtle hover:bg-muted hover:text-fg"
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
      </div>
      <textarea
        autoFocus={autoFocus}
        value={data.code}
        spellCheck={false}
        rows={lines}
        onChange={(e) => onChange({ ...data, code: e.target.value })}
        onKeyDown={(e) => {
          // Tab indents instead of leaving the box
          if (e.key !== "Tab") return;
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: a, selectionEnd: b } = el;
          const next = `${data.code.slice(0, a)}  ${data.code.slice(b)}`;
          onChange({ ...data, code: next });
          requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
        }}
        placeholder="Paste or type code, commands, queries…"
        className={cn(box, "w-full resize-y bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed")}
      />
    </div>
  );
}
