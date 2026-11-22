/**
 * The morning paper as a PDF that reads like a real newspaper: a masthead, the day's headline, the lead story with its
 * picture, the 60-second brief and the world today on the front page, a board of who wins and who loses, then every
 * section in two justified columns: kicker, headline, writer and outlet, the article's picture, the story in detail,
 * who it hits, what it means for you (in a soft "clay" card), and a link to the full story at its source.
 *
 * Built with pdf-lib (pure JavaScript, works on the server). The built-in fonts (Times for the paper, Helvetica for
 * labels) draw Western characters only, so a rupee sign is written "Rs" and anything they cannot draw is left out.
 * Pictures are the articles' own (JPEG or PNG); a story without one is set as text.
 */
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { linkOf, topicName, type Layout, type PaperStory } from "./paper";

export interface Run { text: string; font?: PDFFont; url?: string | null; color?: RGB }

/** Splits a Markdown line into runs: **bold** and [text](url). Pure. */
export function runsOf(line: string): { text: string; bold: boolean; url: string | null }[] {
  const out: { text: string; bold: boolean; url: string | null }[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > at) out.push({ text: line.slice(at, m.index), bold: false, url: null });
    if (m[1]) out.push({ text: m[1], bold: true, url: null });
    else out.push({ text: m[2], bold: false, url: m[3] });
    at = m.index! + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at), bold: false, url: null });
  return out;
}

export interface PaperInput {
  title: string; date: string; dayLine: string; edition: number; owner: string; company: string; tz: string;
  layout: Layout | null; markdown: string; stories: Map<number, PaperStory>; sources: number;
  images?: Map<number, { bytes: Uint8Array; kind: "jpg" | "png" }>;
}

/** Fetches the stories' pictures (JPEG or PNG only, under 2.5 MB), a few at a time, within a time budget. */
export async function fetchImages(stories: PaperStory[], max = 36, budgetMs = 15_000): Promise<Map<number, { bytes: Uint8Array; kind: "jpg" | "png" }>> {
  const out = new Map<number, { bytes: Uint8Array; kind: "jpg" | "png" }>();
  const todo = stories.filter((s) => s.image_url).slice(0, max);
  const deadline = Date.now() + budgetMs;
  for (let i = 0; i < todo.length && Date.now() < deadline - 2_000; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (s) => {
      try {
        const res = await fetch(s.image_url!, { headers: { "user-agent": "Mozilla/5.0 (compatible; DaybookNews/1.0)", accept: "image/jpeg,image/png" }, signal: AbortSignal.timeout(Math.min(7_000, deadline - Date.now())) });
        if (!res.ok || Number(res.headers.get("content-length") ?? 0) > 2_500_000) return;
        const b = new Uint8Array(await res.arrayBuffer());
        if (b.length < 3_000 || b.length > 2_500_000) return;
        const kind = b[0] === 0xff && b[1] === 0xd8 ? "jpg" : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e ? "png" : null;
        if (kind) out.set(s.id, { bytes: b, kind });
      } catch { /* no picture for this one */ }
    }));
  }
  return out;
}

const SWAP: Record<string, string> = { "₹": "Rs ", "→": "->", "←": "<-", "✓": "v", "≤": "<=", "≥": ">=", " ": " ", "−": "-" };

interface Piece { h: number; draw: (x: number, yTop: number, w: number) => void }

export async function paperPdf(p: PaperInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(p.title);
  doc.setAuthor(`Daybook for ${p.owner}`);
  doc.setCreator("Daybook");
  const F = {
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifB: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifI: await doc.embedFont(StandardFonts.TimesRomanItalic),
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansB: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const C = {
    ink: rgb(0.1, 0.11, 0.14), soft: rgb(0.4, 0.42, 0.47), rule: rgb(0.82, 0.84, 0.88), accent: rgb(0.12, 0.32, 0.76),
    fill: rgb(0.15, 0.39, 0.92), clay: rgb(0.94, 0.96, 1), cream: rgb(0.985, 0.98, 0.965), white: rgb(1, 1, 1),
    up: rgb(0.09, 0.55, 0.32), down: rgb(0.8, 0.2, 0.18), mixed: rgb(0.85, 0.55, 0.1), shadow: rgb(0.1, 0.16, 0.38),
  };
  const ok = new Map<string, boolean>();
  const clean = (s: string) => [...s.replace(/[\u2013\u2014]/g, ", ")].map((ch) => {
    if (SWAP[ch] !== undefined) return SWAP[ch];
    if (!ok.has(ch)) { try { F.serif.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); } }
    return ok.get(ch) ? ch : "";
  }).join("");

  const W = 595.28, H = 841.89, M = 38, BOTTOM = 52, GUT = 18;
  const FULL = W - 2 * M, COL = (FULL - GUT) / 2;
  const imgs = new Map<number, PDFImage>();
  for (const [id, im] of p.images ?? []) {
    try { imgs.set(id, im.kind === "jpg" ? await doc.embedJpg(im.bytes) : await doc.embedPng(im.bytes)); } catch { /* unreadable picture */ }
  }

  // ---------------------------------------------------------------- pages and the two-column flow
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let top = H - M;
  const cy = [0, 0];
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.cream });
    top = H - M;
    if (pages.length > 1) {
      page.drawText("THE DAYBOOK DAILY", { x: M, y: H - M + 4, size: 8, font: F.serifB, color: C.ink });
      const right = clean(p.dayLine);
      page.drawText(right, { x: W - M - F.sans.widthOfTextAtSize(right, 7.5), y: H - M + 4, size: 7.5, font: F.sans, color: C.soft });
      page.drawLine({ start: { x: M, y: H - M }, end: { x: W - M, y: H - M }, thickness: 0.8, color: C.ink });
      top = H - M - 14;
    }
    cy[0] = cy[1] = top;
  };
  const link = (x1: number, y1: number, x2: number, y2: number, url: string) => {
    const a = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x1, y1, x2, y2], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
    page.node.addAnnot(doc.context.register(a));
  };
  /** A block across the page, under both columns. */
  const full = (pc: Piece) => {
    let y = Math.min(cy[0], cy[1]);
    if (y - pc.h < BOTTOM) { newPage(); y = top; }
    pc.draw(M, y, FULL);
    cy[0] = cy[1] = y - pc.h;
  };
  const fullAll = (ps: Piece[]) => ps.forEach(full);
  /** A story into the column with more room; it may run on into the other column or the next page. */
  const flow = (head: Piece, rest: Piece[]) => {
    let c = cy[0] >= cy[1] ? 0 : 1;
    if (cy[c] - head.h < BOTTOM) {
      const o = 1 - c;
      if (cy[o] - head.h >= BOTTOM) c = o; else { newPage(); c = 0; }
    }
    head.draw(M + c * (COL + GUT), cy[c], COL);
    cy[c] -= head.h;
    for (const pc of rest) {
      if (cy[c] - pc.h < BOTTOM) {
        if (c === 0 && cy[1] - pc.h >= BOTTOM) c = 1; else { newPage(); c = 0; }
      }
      pc.draw(M + c * (COL + GUT), cy[c], COL);
      cy[c] -= pc.h;
    }
  };
  const gap = (h: number): Piece => ({ h, draw: () => {} });
  const group = (ps: Piece[]): Piece => ({ h: ps.reduce((a, b) => a + b.h, 0), draw: (x, y, w) => { let t = y; for (const pc of ps) { pc.draw(x, t, w); t -= pc.h; } } });

  // ---------------------------------------------------------------- text
  /** Lines of text as pieces, wrapped to the width, justified when asked (the last line stays ragged). */
  const text = (runs: Run[], o: { size: number; lead: number; width: number; font?: PDFFont; color?: RGB; justify?: boolean; indent?: number; center?: boolean }): Piece[] => {
    type Word = { w: string; font: PDFFont; url: string | null; color: RGB; width: number };
    const words: Word[] = [];
    for (const r of runs) {
      const font = r.font ?? o.font ?? F.serif;
      for (const w of clean(r.text).split(/\s+/).filter(Boolean)) words.push({ w, font, url: r.url ?? null, color: r.color ?? (r.url ? C.accent : o.color ?? C.ink), width: font.widthOfTextAtSize(w, o.size) });
    }
    const space = (o.font ?? F.serif).widthOfTextAtSize(" ", o.size);
    const lines: Word[][] = [];
    let cur: Word[] = [], used = 0;
    for (const w of words) {
      const max = o.width - (lines.length === 0 ? o.indent ?? 0 : 0);
      if (cur.length && used + space + w.width > max) { lines.push(cur); cur = []; used = 0; }
      used += (cur.length ? space : 0) + w.width;
      cur.push(w);
    }
    if (cur.length) lines.push(cur);
    return lines.map((ln, i) => ({
      h: o.lead,
      draw: (x, y) => {
        const indent = i === 0 ? o.indent ?? 0 : 0;
        const natural = ln.reduce((a, w) => a + w.width, 0) + space * (ln.length - 1);
        const extra = o.justify && i < lines.length - 1 && ln.length > 1 ? Math.min(4, (o.width - indent - natural) / (ln.length - 1)) : 0;
        let cx = x + indent + (o.center ? (o.width - natural) / 2 : 0);
        for (const w of ln) {
          page.drawText(w.w, { x: cx, y: y - o.size, size: o.size, font: w.font, color: w.color });
          if (w.url) link(cx, y - o.size - 2, cx + w.width + space, y + 1, w.url);
          cx += w.width + space + extra;
        }
      },
    }));
  };
  const rrPath = (w: number, h: number, r: number) => `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
  /** A soft "clay" card: a rounded panel with a two-layer shadow and a light edge, the content inside. */
  const clay = (inner: (w: number) => Piece[], o: { width: number; pad?: number; fill?: RGB; edge?: RGB }): Piece => {
    const pad = o.pad ?? 10;
    const content = group(inner(o.width - 2 * pad));
    const h = content.h + 2 * pad;
    return {
      h: h + 8,
      draw: (x, y) => {
        page.drawSvgPath(rrPath(o.width, h, 9), { x: x + 1, y: y - 4, color: C.shadow, opacity: 0.06 });
        page.drawSvgPath(rrPath(o.width, h, 9), { x: x + 0.5, y: y - 1.8, color: C.shadow, opacity: 0.07 });
        page.drawSvgPath(rrPath(o.width, h, 9), { x, y, color: o.fill ?? C.clay, borderColor: o.edge ?? C.white, borderWidth: 1 });
        content.draw(x + pad, y - pad, o.width - 2 * pad);
      },
    };
  };
  const triangle = (x: number, y: number, move: string) => {
    const col = move === "up" ? C.up : move === "down" ? C.down : C.mixed;
    if (move === "mixed") page.drawCircle({ x: x + 3.5, y: y + 3.2, size: 3, color: col });
    else page.drawSvgPath(move === "up" ? "M 0 7 L 3.5 0 L 7 7 Z" : "M 0 0 L 7 0 L 3.5 7 Z", { x, y: y + 7, color: col });
  };
  const label = (s: string, color = C.accent, size = 7.5): Piece => ({ h: size + 5, draw: (x, y) => page.drawText(clean(s.toUpperCase()), { x, y: y - size, size, font: F.sansB, color }) });
  const rule = (thick = 0.5, color = C.rule, space = 8): Piece => ({ h: space, draw: (x, y, w) => page.drawLine({ start: { x, y: y - space / 2 }, end: { x: x + w, y: y - space / 2 }, thickness: thick, color }) });
  const heading = (s: string, right = ""): Piece => ({
    h: 24,
    draw: (x, y, w) => {
      page.drawText(clean(s.toUpperCase()), { x, y: y - 12, size: 10, font: F.sansB, color: C.accent });
      if (right) page.drawText(clean(right), { x: x + w - F.sans.widthOfTextAtSize(clean(right), 7.5), y: y - 12, size: 7.5, font: F.sans, color: C.soft });
      page.drawLine({ start: { x, y: y - 17 }, end: { x: x + w, y: y - 17 }, thickness: 1.2, color: C.accent });
    },
  });
  const picture = (id: number, width: number, maxH: number, credit: string | null): Piece | null => {
    const im = imgs.get(id);
    if (!im) return null;
    const ratio = im.height / im.width;
    let w = width, h = width * ratio;
    if (h > maxH) { h = maxH; w = h / ratio; }
    if (h < 40) return null;
    const cap = credit ? text([{ text: `Picture: ${credit}`, font: F.sans, color: C.soft }], { size: 6.5, lead: 9, width }) : [];
    return {
      h: h + 6 + cap.length * 9 + 4,
      draw: (x, y, fullW) => {
        const ix = x + (fullW - w) / 2;
        page.drawRectangle({ x: ix + 1, y: y - h - 2.5, width: w, height: h, color: C.shadow, opacity: 0.1 });
        page.drawImage(im, { x: ix, y: y - h, width: w, height: h });
        page.drawRectangle({ x: ix, y: y - h, width: w, height: h, borderColor: C.white, borderWidth: 1.2 });
        let t = y - h - 4;
        for (const c of cap) { c.draw(x, t, fullW); t -= c.h; }
      },
    };
  };
  const when = (s: PaperStory) => {
    const d = new Date(s.published_at ?? s.found_at);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", { timeZone: p.tz, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(",", "");
  };
  const byline = (s: PaperStory, width: number) => text([{ text: [s.author ? `By ${s.author}` : null, s.outlet, when(s)].filter(Boolean).join("  |  "), font: F.sans, color: C.soft }], { size: 7, lead: 10, width });
  const source = (s: PaperStory, width: number) => text([{ text: `Read the full story at ${s.outlet ?? "the source"} >`, font: F.sansB, url: linkOf(s) }], { size: 7.5, lead: 11, width });

  /** One story set in a column: kicker, headline, byline, picture, the story, who it hits, for you, the link. */
  const story = (s: PaperStory, width: number) => {
    const kicker: Piece = {
      h: 11,
      draw: (x, y) => {
        let cx = x;
        if (s.impact && s.impact !== "none") { triangle(cx, y - 8, s.impact); cx += 10; }
        page.drawText(clean(topicName(s.topic).toUpperCase()), { x: cx, y: y - 7.5, size: 6.8, font: F.sansB, color: C.accent });
      },
    };
    const pic = picture(s.id, width, 150, s.outlet);
    const head = group([kicker, ...text([{ text: s.title, font: F.serifB }], { size: 13.5, lead: 15.5, width }), gap(2), ...byline(s, width), gap(3), ...(pic ? [pic] : [])]);
    const rest: Piece[] = [];
    const body = s.detail ?? s.summary ?? "";
    for (const para of body.split(/\n{2,}/).filter((x) => x.trim())) rest.push(...text([{ text: para }], { size: 9.6, lead: 12.4, width, justify: true }), gap(3));
    if (s.affects) rest.push(gap(2), ...text([{ text: "WHO IT HITS  ", font: F.sansB, color: C.accent }, { text: s.affects, font: F.serifI }], { size: 8.8, lead: 11.5, width }), gap(3));
    const fy = s.for_you || s.action || s.why;
    if (fy) rest.push(clay((w) => [label("For you", C.accent, 6.8), ...text([{ text: fy, font: F.sans }], { size: 8.3, lead: 11, width: w })], { width, pad: 8 }));
    rest.push(...source(s, width), rule(0.5, C.rule, 14));
    // a headline never ends a column alone: it keeps its first three lines
    return { head: group([head, ...rest.slice(0, 3)]), rest: rest.slice(3) };
  };

  // ---------------------------------------------------------------- the front page
  newPage();
  const L = p.layout;
  const mast: Piece = {
    h: 118,
    draw: (x, y, w) => {
      page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 2.2, color: C.ink });
      page.drawText(clean(`PERSONAL EDITION FOR ${p.owner.toUpperCase()}`), { x, y: y - 12, size: 7, font: F.sansB, color: C.soft });
      const no = `No. ${p.edition}`;
      page.drawText(no, { x: x + w - F.sansB.widthOfTextAtSize(no, 7), y: y - 12, size: 7, font: F.sansB, color: C.soft });
      const name = "The Daybook Daily";
      page.drawText(name, { x: x + (w - F.serifB.widthOfTextAtSize(name, 44)) / 2, y: y - 58, size: 44, font: F.serifB, color: C.ink });
      const tag = clean(`The news that moves your business, read every morning for ${p.company}`);
      page.drawText(tag, { x: x + (w - F.serifI.widthOfTextAtSize(tag, 10)) / 2, y: y - 76, size: 10, font: F.serifI, color: C.soft });
      page.drawLine({ start: { x, y: y - 86 }, end: { x: x + w, y: y - 86 }, thickness: 1.4, color: C.ink });
      page.drawLine({ start: { x, y: y - 89 }, end: { x: x + w, y: y - 89 }, thickness: 0.5, color: C.ink });
      const line = clean(`${p.dayLine}   |   ${p.stories.size} stories from ${p.sources} sources   |   every story links to its source`);
      page.drawText(line, { x: x + (w - F.sans.widthOfTextAtSize(line, 7.5)) / 2, y: y - 101, size: 7.5, font: F.sans, color: C.ink });
      page.drawLine({ start: { x, y: y - 108 }, end: { x: x + w, y: y - 108 }, thickness: 0.5, color: C.ink });
    },
  };
  full(mast);

  if (!L) {
    // an edition from before the newspaper layout: its Markdown, set plainly
    for (const raw of p.markdown.split("\n")) {
      const ln = raw.trim();
      if (!ln || /^#\s/.test(ln)) continue;
      if (/^##\s/.test(ln)) { full(gap(6)); full(heading(ln.replace(/^##\s+/, ""))); continue; }
      const runs = runsOf(ln.replace(/^[-*]\s+/, "")).map((r) => ({ text: r.text, url: r.url, font: r.bold ? F.serifB : F.serif }));
      fullAll(text(runs, { size: 10.5, lead: 14, width: FULL }));
      full(gap(4));
    }
  } else {
    const byId = p.stories;
    const lead = L.lead ? byId.get(L.lead) : undefined;
    fullAll(text([{ text: L.headline, font: F.serifB }], { size: 27, lead: 30, width: FULL }));
    if (L.standfirst) { full(gap(2)); fullAll(text([{ text: L.standfirst, font: F.serifI }], { size: 12.5, lead: 16, width: FULL, color: C.soft })); }
    full(gap(8));
    if (lead) {
      const pic = picture(lead.id, FULL, 190, lead.outlet);
      if (pic) full(pic);
      fullAll(byline(lead, FULL));
      full(gap(3));
      const body = lead.detail ?? lead.summary ?? "";
      body.split(/\n{2,}/).filter((x) => x.trim()).forEach((para, i) => {
        fullAll(text([{ text: para }], { size: 10.8, lead: 14.4, width: FULL, justify: true, indent: i ? 0 : 0 }));
        full(gap(4));
      });
      if (lead.affects) fullAll(text([{ text: "WHO IT HITS  ", font: F.sansB, color: C.accent }, { text: lead.affects, font: F.serifI }], { size: 9.8, lead: 13, width: FULL }));
      full(gap(5));
      if (lead.for_you) full(clay((w) => [label("What it means for you"), ...text([{ text: lead.for_you!, font: F.sans }], { size: 9.4, lead: 12.5, width: w })], { width: FULL }));
      fullAll(source(lead, FULL));
      full(gap(10));
    }
    if (L.brief.length) {
      full(heading("The 60-second brief", `${L.brief.length} things to know today`));
      L.brief.forEach((b, i) => {
        const s = b.id ? byId.get(b.id) : undefined;
        flow(clay((w) => {
          const lines = text([{ text: b.text, font: F.serif }, ...(s ? [{ text: ` ${s.outlet ?? "Source"} >`, font: F.sansB, url: linkOf(s) }] : [])], { size: 9.6, lead: 12.6, width: w - 20 });
          return lines.map((pc, k) => ({ h: pc.h, draw: (x: number, y: number, ww: number) => {
            if (k === 0) {
              page.drawCircle({ x: x + 6.5, y: y - 6, size: 6.5, color: C.fill });
              const n = String(i + 1);
              page.drawText(n, { x: x + 6.5 - F.sansB.widthOfTextAtSize(n, 7.5) / 2, y: y - 8.6, size: 7.5, font: F.sansB, color: C.white });
            }
            pc.draw(x + 20, y, ww - 20);
          } }));
        }, { width: COL, pad: 9 }), []);
      });
      full(gap(8));
    }
    if (L.glance) {
      full(heading("The world today", "how it moves demand and supply"));
      fullAll(text([{ text: L.glance }], { size: 10.6, lead: 14.4, width: FULL, justify: true }));
      full(gap(10));
    }
    if (L.note) {
      full(clay((w) => [label("From the editor", C.soft), ...text([{ text: L.note, font: F.serifI }], { size: 10, lead: 13.4, width: w })], { width: FULL, fill: C.white, edge: C.rule }));
      full(gap(8));
    }
    if (L.sectors.length) {
      full(heading("Who wins, who loses today", "sectors and businesses"));
      for (const sec of L.sectors) {
        const card = clay((w) => [
          { h: 13, draw: (x, y) => { triangle(x, y - 9, sec.move); page.drawText(clean(sec.name), { x: x + 11, y: y - 9, size: 9.5, font: F.sansB, color: C.ink }); } },
          ...text([{ text: sec.why, font: F.serif }], { size: 9, lead: 11.8, width: w }),
          ...sec.ids.slice(0, 2).flatMap((id) => { const s = byId.get(id); return s ? text([{ text: `${s.outlet ?? "Source"} >`, font: F.sansB, url: linkOf(s) }], { size: 7, lead: 10, width: w }) : []; }),
        ], { width: COL, pad: 9, fill: sec.move === "up" ? rgb(0.93, 0.98, 0.95) : sec.move === "down" ? rgb(0.995, 0.94, 0.93) : rgb(1, 0.97, 0.91) });
        flow(card, []);
      }
      full(gap(6));
    }
    for (const sec of L.sections) {
      const band: Piece = {
        h: 36,
        draw: (x, y, w) => {
          page.drawSvgPath(rrPath(w, 24, 8), { x: x + 0.8, y: y - 2.5, color: C.shadow, opacity: 0.1 });
          page.drawSvgPath(rrPath(w, 24, 8), { x, y, color: C.fill });
          page.drawText(clean(sec.title.toUpperCase()), { x: x + 12, y: y - 16, size: 11, font: F.sansB, color: C.white });
          const n = `${sec.ids.length} ${sec.ids.length === 1 ? "story" : "stories"}`;
          page.drawText(n, { x: x + w - 12 - F.sans.widthOfTextAtSize(n, 8), y: y - 15.5, size: 8, font: F.sans, color: C.white });
        },
      };
      const set = sec.ids.map((id) => byId.get(id)).filter((s): s is PaperStory => !!s).map((s) => story(s, COL));
      // a section starts with room for its band and its first story's head
      if (Math.min(cy[0], cy[1]) - band.h - (set[0]?.head.h ?? 0) < BOTTOM) newPage();
      full(band);
      for (const { head, rest } of set) flow(head, rest);
    }
    if (L.opportunities.length || L.today.length) {
      if (Math.min(cy[0], cy[1]) - 140 < BOTTOM) newPage();
      full(gap(4));
      if (L.opportunities.length) {
        full(clay((w) => [
          label(`Opportunities for ${p.company}`, C.accent, 8.5), gap(2),
          ...L.opportunities.flatMap((o) => {
            const s = o.id ? byId.get(o.id) : undefined;
            return [...text([{ text: "+  ", font: F.sansB, color: C.up }, { text: o.idea }, ...(s ? [{ text: ` (${s.outlet ?? "source"})`, font: F.sans, url: linkOf(s) }] : [])], { size: 10, lead: 13.2, width: w }), gap(4)];
          }),
        ], { width: FULL, pad: 14 }));
      }
      if (L.today.length) {
        full(clay((w) => [
          label("Do today", C.accent, 8.5), gap(2),
          ...L.today.flatMap((t) => [{ h: 0, draw: (x: number, y: number) => page.drawRectangle({ x, y: y - 9.5, width: 8, height: 8, borderColor: C.accent, borderWidth: 1 }) }, ...text([{ text: t, font: F.sans }], { size: 9.8, lead: 13, width: w - 14, indent: 0 }).map((pc) => ({ h: pc.h, draw: (x: number, y: number, ww: number) => pc.draw(x + 14, y, ww) })), gap(3)]),
        ], { width: FULL, pad: 14, fill: C.white, edge: C.rule }));
      }
    }
    full(gap(6));
    fullAll(text([{ text: "How this paper is made: every story was read from its publisher and written up from the article only. Click any outlet name or \"Read the full story\" to open the original.", font: F.serifI, color: C.soft }], { size: 8, lead: 10.5, width: FULL, center: true }));
  }

  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: 38 }, end: { x: W - M, y: 38 }, thickness: 0.5, color: C.rule });
    pg.drawText(clean(`The Daybook Daily  |  ${p.dayLine}`), { x: M, y: 27, size: 7, font: F.sans, color: C.soft });
    const n = `Page ${i + 1} of ${pages.length}`;
    pg.drawText(n, { x: W - M - F.sans.widthOfTextAtSize(n, 7), y: 27, size: 7, font: F.sans, color: C.soft });
  });
  return doc.save({ useObjectStreams: false });
}
