"use client";

import { Fragment, type ReactNode } from "react";

/**
 * A small markdown renderer for assistant answers: headings, paragraphs, bullet and numbered lists, bold, italic,
 * inline code, code blocks, links and pipe tables. It builds React elements (never raw HTML), so text that came
 * from the database cannot inject markup.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // order matters: code first (its content is literal), then links, bold, italic
  const re = /(`[^`]+`)|\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{m[1].slice(1, -1)}</code>);
    else if (m[2]) {
      const external = m[3].startsWith("http");
      out.push(
        <a key={k} href={m[3]} className="text-accent underline underline-offset-2" {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
          {m[2]}
        </a>,
      );
    } else if (m[4]) out.push(<strong key={k} className="font-semibold">{inline(m[4].slice(2, -2), k)}</strong>);
    else if (m[5]) out.push(<em key={k}>{m[5].slice(1, -1)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isDivider = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${key++}`;

    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={k} className="overflow-x-auto rounded-xl bg-muted p-3 font-mono text-xs leading-relaxed">{body.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      blocks.push(
        <p key={k} className={level <= 2 ? "mt-1 font-display text-base font-semibold" : "mt-1 text-sm font-semibold"}>
          {inline(h[2], k)}
        </p>,
      );
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k} className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-subtle">
              <tr>{head.map((c, j) => <th key={j} className="px-2.5 py-1.5 font-medium">{inline(c, `${k}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-border/70">
                  {r.map((c, j) => <td key={j} className="px-2.5 py-1.5 tabular-nums">{inline(c, `${k}r${ri}c${j}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        const depth = (/^(\s*)/.exec(lines[i])![1].length >= 2) ? 1 : 0;
        items.push({ text: lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""), depth });
        i++;
        // continuation lines of the same item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i++;
        }
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={k} className={ordered ? "list-decimal space-y-1 pl-5" : "space-y-1"}>
          {items.map((it, j) => (
            <li key={j} className={ordered ? "pl-1" : `flex gap-2 ${it.depth ? "pl-5" : ""}`}>
              {ordered ? null : <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />}
              <span>{inline(it.text, `${k}-${j}`)}</span>
            </li>
          ))}
        </List>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i]) && !(isTableRow(lines[i]) && isDivider(lines[i + 1] ?? ""))) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={k}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j ? <br /> : null}
            {inline(p, `${k}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="space-y-2.5 text-sm leading-relaxed">{blocks}</div>;
}
