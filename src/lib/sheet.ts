/**
 * The scratchpad table's formulas, on top of the calculator's maths: a cell starting with "=" is a formula.
 *   =A1+B1   =A1*18%   =SUM(A1:A10)   =AVG(B2:B8)   =MAX(A1:C3)   =COUNT(A1:A20)   =ROUND(C4, 2)
 * Ranges expand to the cells in them; text cells count as nothing in ranges and as an error when used directly.
 */
import { calc, CalcError } from "./calc";

export const colName = (c: number) => String.fromCharCode(65 + c);

export type CellValue = { kind: "empty" } | { kind: "text"; text: string } | { kind: "number"; value: number } | { kind: "error"; error: string };

const NUMBER = /^\s*[-+]?(\d[\d,]*\.?\d*|\.\d+)\s*%?\s*$/;

function asNumber(raw: string): number | null {
  if (!NUMBER.test(raw)) return null;
  const pct = raw.trim().endsWith("%");
  const n = Number(raw.replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? (pct ? n / 100 : n) : null;
}

/** Evaluates every cell. Cycles and bad formulas become errors in their cell, never a crash. */
export function evaluateSheet(rows: string[][]): CellValue[][] {
  const out: (CellValue | undefined)[][] = rows.map((r) => r.map(() => undefined));
  const visiting = new Set<string>();

  const value = (r: number, c: number): CellValue => {
    const known = out[r]?.[c];
    if (known) return known;
    const raw = rows[r]?.[c] ?? "";
    let v: CellValue;
    if (!raw.trim()) v = { kind: "empty" };
    else if (!raw.startsWith("=")) {
      const n = asNumber(raw);
      v = n === null ? { kind: "text", text: raw } : { kind: "number", value: n };
    } else {
      const key = `${r}:${c}`;
      if (visiting.has(key)) return { kind: "error", error: "#CYCLE" };
      visiting.add(key);
      v = formula(raw.slice(1));
      visiting.delete(key);
    }
    if (out[r]) out[r][c] = v;
    return v;
  };

  const cellNum = (ref: string): number => {
    const m = /^([A-Z])(\d{1,3})$/.exec(ref.toUpperCase())!;
    const v = value(Number(m[2]) - 1, m[1].charCodeAt(0) - 65);
    if (v.kind === "number") return v.value;
    if (v.kind === "empty") return 0;
    if (v.kind === "error") throw new CalcError(v.error);
    throw new CalcError(`${ref} is text`);
  };

  const formula = (src: string): CellValue => {
    try {
      // ranges -> the list of their non-empty numeric cells
      let expr = src.replace(/\b([A-Z])(\d{1,3}):([A-Z])(\d{1,3})\b/gi, (_, c1: string, r1: string, c2: string, r2: string) => {
        const [ca, cb] = [c1.toUpperCase().charCodeAt(0) - 65, c2.toUpperCase().charCodeAt(0) - 65].sort((a, b) => a - b);
        const [ra, rb] = [Number(r1) - 1, Number(r2) - 1].sort((a, b) => a - b);
        const nums: string[] = [];
        for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) {
          const v = value(r, c);
          if (v.kind === "number") nums.push(`(${v.value})`);
          else if (v.kind === "error") throw new CalcError(v.error);
        }
        return nums.length ? nums.join(",") : "0";
      });
      const vars: Record<string, number> = {};
      expr = expr.replace(/\b([A-Z])(\d{1,3})\b/gi, (ref: string) => {
        const name = `c_${ref.toLowerCase()}`;
        vars[name] = cellNum(ref);
        return name;
      });
      const n = calc(expr.toLowerCase(), vars);
      return Number.isFinite(n) ? { kind: "number", value: n } : { kind: "error", error: "#DIV/0" };
    } catch (e) {
      return { kind: "error", error: e instanceof CalcError && e.message.startsWith("#") ? e.message : "#ERR" };
    }
  };

  return rows.map((r, i) => r.map((_, j) => value(i, j)));
}

export function showCell(v: CellValue): string {
  switch (v.kind) {
    case "empty": return "";
    case "text": return v.text;
    case "error": return v.error;
    case "number": {
      const r = Math.abs(v.value) >= 1e15 ? v.value.toExponential(4) : String(Number(v.value.toPrecision(12)));
      return r;
    }
  }
}
