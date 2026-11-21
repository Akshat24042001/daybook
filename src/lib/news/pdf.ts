/**
 * The newsletter as a PDF: A4, a title band, section headings, points with bold names, and each source as a clickable
 * link. Built with pdf-lib (pure JavaScript, works on the server). The built-in fonts cover Western characters only, so
 * a rupee sign is written "Rs" and characters they cannot draw (emoji, other scripts) are left out.
 */
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

interface Run { text: string; bold: boolean; url: string | null }

/** Splits a Markdown line into runs: **bold** and [text](url). Pure. */
export function runsOf(line: string): Run[] {
  const out: Run[] = [];
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

const SWAP: Record<string, string> = { "₹": "Rs ", "→": "->", "←": "<-", "✓": "v", "≤": "<=", "≥": ">=", " ": " " };

export async function editionPdf(e: { title: string; date: string; markdown: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(e.title);
  doc.setCreator("Daybook");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ok = new Map<string, boolean>();
  const clean = (s: string) => [...s].map((ch) => {
    if (SWAP[ch] !== undefined) return SWAP[ch];
    if (!ok.has(ch)) { try { reg.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); } }
    return ok.get(ch) ? ch : "";
  }).join("");

  const W = 595.28, H = 841.89, M = 50, BOTTOM = 60;
  const ink = rgb(0.11, 0.12, 0.14), soft = rgb(0.42, 0.44, 0.48), accent = rgb(0.15, 0.33, 0.85), band = rgb(0.95, 0.96, 0.99);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const pages: PDFPage[] = [page];
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - M; };
  const need = (h: number) => { if (y - h < BOTTOM) newPage(); };

  const link = (x1: number, y1: number, x2: number, y2: number, url: string) => {
    const annot = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x1, y1, x2, y2], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
    page.node.addAnnot(doc.context.register(annot));
  };

  /** Writes runs word by word, wrapping at the margin. */
  const write = (runs: Run[], o: { size: number; x: number; lead: number; color?: ReturnType<typeof rgb> }) => {
    const words: { w: string; font: PDFFont; url: string | null }[] = [];
    for (const r of runs) for (const w of clean(r.text).split(/(\s+)/).filter((x) => x.length)) words.push({ w, font: r.bold ? bold : reg, url: r.url });
    let x = o.x;
    need(o.lead);
    for (const t of words) {
      if (/^\s+$/.test(t.w)) { if (x > o.x) x += reg.widthOfTextAtSize(" ", o.size); continue; }
      const width = t.font.widthOfTextAtSize(t.w, o.size);
      if (x + width > W - M && x > o.x) { y -= o.lead; need(o.lead); x = o.x; }
      page.drawText(t.w, { x, y: y - o.size, size: o.size, font: t.font, color: t.url ? accent : o.color ?? ink });
      if (t.url) link(x, y - o.size - 2, x + width, y + 1, t.url);
      x += width;
    }
    y -= o.lead;
  };

  // title band
  page.drawRectangle({ x: 0, y: H - 110, width: W, height: 110, color: band });
  page.drawText("DAYBOOK  ·  MORNING BRIEF", { x: M, y: H - 42, size: 9, font: bold, color: accent });
  y = H - 54;
  write([{ text: e.title, bold: true, url: null }], { size: 18, x: M, lead: 24 });
  y = H - 128;

  for (const raw of e.markdown.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { y -= 4; continue; }
    if (/^#\s/.test(line)) continue; // the title is in the band
    if (/^##\s/.test(line)) {
      need(40);
      y -= 10;
      write([{ text: line.replace(/^##\s+/, "").toUpperCase(), bold: true, url: null }], { size: 10.5, x: M, lead: 16, color: accent });
      page.drawLine({ start: { x: M, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.6, color: rgb(0.85, 0.87, 0.9) });
      y -= 6;
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (bullet) {
      need(16);
      page.drawCircle({ x: M + 4, y: y - 6.5, size: 1.8, color: accent });
      write(runsOf(bullet[1]), { size: 10.5, x: M + 14, lead: 15 });
      y -= 3;
      continue;
    }
    write(runsOf(line.replace(/^>\s?/, "")), { size: 10.5, x: M, lead: 15 });
  }

  pages.forEach((p, i) => {
    p.drawText(`${e.date}  ·  page ${i + 1} of ${pages.length}`, { x: M, y: 30, size: 8, font: reg, color: soft });
  });
  void PDFName;
  return doc.save({ useObjectStreams: false });
}
