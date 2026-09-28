/**
 * A small, safe math language for the scratchpad calculator and graphs. No eval: text is tokenised, parsed
 * (recursive descent) into a tree, and the tree is evaluated against a variable map.
 *
 *   2 + 3 * 4        12        2^10          1024       18% of 2400     432
 *   2(3 + 4)         14        5!            120        sqrt(2)         1.4142…
 *   sin(30deg)       0.5       rate = 18%    0.18       2400 * rate     432
 *   ans / 2          uses the previous result       7 mod 3            1
 *
 * Graph functions use the same language with `x` free: "x^2", "y = 2x + 1", "sin(x) / x".
 */

export class CalcError extends Error {}

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "post"; op: "!" | "%"; a: Node }
  | { k: "call"; name: string; args: Node[] };

export type Vars = Record<string, number>;

const CONSTS: Vars = { pi: Math.PI, "π": Math.PI, e: Math.E, tau: 2 * Math.PI, deg: Math.PI / 180, inf: Infinity };

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return gamma(n + 1);
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// Lanczos approximation, so 0.5! and friends still give an answer
function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
}

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, log2: Math.log2, log10: Math.log10,
  floor: Math.floor, ceil: Math.ceil, round: (x, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; },
  min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot, sign: Math.sign,
  avg: (...a) => a.reduce((s, v) => s + v, 0) / a.length,
  sum: (...a) => a.reduce((s, v) => s + v, 0),
  fact: factorial,
};

/** Names a user cannot assign to. */
export function isReserved(name: string): boolean {
  return name in FUNCS || name in CONSTS || name === "of" || name === "mod";
}

function tokenize(src: string): Tok[] {
  const s = src
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/√/g, "sqrt");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(\d[\d_]*\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      out.push({ t: "num", v: parseFloat(num[0].replace(/_/g, "")) });
      i += num[0].length;
      continue;
    }
    const id = /^[a-zA-Zπ_][a-zA-Z0-9_]*/.exec(s.slice(i));
    if (id) {
      out.push({ t: "id", v: id[0] === "π" ? "pi" : id[0] });
      i += id[0].length;
      continue;
    }
    if (s.startsWith("**", i)) { out.push({ t: "op", v: "^" }); i += 2; continue; }
    if ("+-*/^(),!%=".includes(ch)) { out.push({ t: "op", v: ch }); i++; continue; }
    throw new CalcError(`Unexpected "${ch}"`);
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok | undefined { return this.toks[this.i]; }
  private isOp(v: string): boolean { const t = this.peek(); return !!t && t.t === "op" && t.v === v; }
  private isId(v: string): boolean { const t = this.peek(); return !!t && t.t === "id" && t.v === v; }
  private expect(v: string) {
    if (!this.isOp(v)) throw new CalcError(v === ")" ? "Missing )" : `Expected ${v}`);
    this.i++;
  }

  parse(): Node {
    if (!this.toks.length) throw new CalcError("Empty");
    const n = this.expr();
    if (this.i < this.toks.length) {
      const t = this.toks[this.i];
      throw new CalcError(t.t === "op" && t.v === ")" ? "Extra )" : `Unexpected "${String(t.v)}"`);
    }
    return n;
  }

  // expr := term (("+"|"-") term)*
  private expr(): Node {
    let n = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.toks[this.i++] as { v: string }).v;
      const b = this.term();
      // calculator habit: "2400 + 10%" is 2640, not 2400.1
      n = b.k === "post" && b.op === "%"
        ? { k: "bin", op: "*", a: n, b: { k: "bin", op, a: { k: "num", v: 1 }, b } }
        : { k: "bin", op, a: n, b };
    }
    return n;
  }

  // term := unary (("*"|"/"|"mod"|"of"|implicit) unary)*
  private term(): Node {
    let n = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const op = (this.toks[this.i++] as { v: string }).v;
        n = { k: "bin", op, a: n, b: this.unary() };
      } else if (this.isId("mod")) {
        this.i++;
        n = { k: "bin", op: "mod", a: n, b: this.unary() };
      } else if (this.isId("of")) {
        this.i++;
        n = { k: "bin", op: "*", a: n, b: this.unary() };
      } else if (this.startsImplicit()) {
        n = { k: "bin", op: "*", a: n, b: this.power() };
      } else {
        return n;
      }
    }
  }

  // "2x", "3(x+1)", "(a)(b)", "2pi": a value directly followed by a name or "(" multiplies
  private startsImplicit(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.t === "num") return true;
    if (t.t === "id") return t.v !== "mod" && t.v !== "of";
    return t.t === "op" && t.v === "(";
  }

  private unary(): Node {
    if (this.isOp("-")) { this.i++; return { k: "neg", a: this.unary() }; }
    if (this.isOp("+")) { this.i++; return this.unary(); }
    return this.power();
  }

  // power := postfix ("^" unary)?   (right-associative, and -2^2 = -4)
  private power(): Node {
    const base = this.postfix();
    if (this.isOp("^")) {
      this.i++;
      return { k: "bin", op: "^", a: base, b: this.unary() };
    }
    return base;
  }

  private postfix(): Node {
    let n = this.atom();
    for (;;) {
      if (this.isOp("!")) { this.i++; n = { k: "post", op: "!", a: n }; }
      else if (this.isOp("%")) { this.i++; n = { k: "post", op: "%", a: n }; }
      else return n;
    }
  }

  private atom(): Node {
    const t = this.peek();
    if (!t) throw new CalcError("Incomplete");
    if (t.t === "num") { this.i++; return { k: "num", v: t.v }; }
    if (t.t === "id") {
      this.i++;
      if (this.isOp("(") && t.v in FUNCS) {
        this.i++;
        const args: Node[] = [];
        if (!this.isOp(")")) {
          args.push(this.expr());
          while (this.isOp(",")) { this.i++; args.push(this.expr()); }
        }
        this.expect(")");
        return { k: "call", name: t.v, args };
      }
      if (t.v in FUNCS) {
        // "sqrt 2", "sin x": a function name followed by a plain value
        return { k: "call", name: t.v, args: [this.power()] };
      }
      return { k: "var", name: t.v };
    }
    if (t.v === "(") {
      this.i++;
      const n = this.expr();
      this.expect(")");
      return n;
    }
    throw new CalcError(`Unexpected "${t.v}"`);
  }
}

export function parse(src: string): Node {
  return new Parser(tokenize(src)).parse();
}

export function evaluate(n: Node, vars: Vars): number {
  switch (n.k) {
    case "num": return n.v;
    case "var": {
      if (n.name in vars) return vars[n.name];
      if (n.name in CONSTS) return CONSTS[n.name];
      throw new CalcError(`Unknown "${n.name}"`);
    }
    case "neg": return -evaluate(n.a, vars);
    case "post": {
      const a = evaluate(n.a, vars);
      return n.op === "%" ? a / 100 : factorial(a);
    }
    case "call": {
      const f = FUNCS[n.name];
      if (!n.args.length) throw new CalcError(`${n.name}() needs a value`);
      return f(...n.args.map((a) => evaluate(a, vars)));
    }
    case "bin": {
      const a = evaluate(n.a, vars);
      const b = evaluate(n.b, vars);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "^": return a ** b;
        case "mod": return ((a % b) + b) % b;
      }
    }
  }
  throw new CalcError("Cannot evaluate");
}

/** Evaluates one expression. Throws CalcError on bad input. */
export function calc(src: string, vars: Vars = {}): number {
  return evaluate(parse(src), vars);
}

export type LineResult =
  | { kind: "empty" }
  | { kind: "comment" }
  | { kind: "value"; value: number; name?: string }
  | { kind: "error"; error: string };

const ASSIGN = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)(.*)$/;

/**
 * Runs a calculator tape top to bottom. Each line may be an expression, an assignment ("rent = 18000"),
 * blank, or a comment ("# groceries" / "// note"). `ans` is the last value. Returns one result per line.
 */
export function runTape(lines: string[]): LineResult[] {
  const vars: Vars = {};
  return lines.map((raw): LineResult => {
    const line = raw.replace(/(#|\/\/).*$/, "").trim().replace(/=\s*$/, "").trim();
    if (!line) return raw.trim() ? { kind: "comment" } : { kind: "empty" };
    try {
      const m = ASSIGN.exec(line);
      if (m) {
        const name = m[1];
        if (isReserved(name) || name === "ans") throw new CalcError(`"${name}" is a built-in name`);
        const value = calc(m[2], vars);
        vars[name] = value;
        vars.ans = value;
        return { kind: "value", value, name };
      }
      const value = calc(line, vars);
      vars.ans = value;
      return { kind: "value", value };
    } catch (e) {
      return { kind: "error", error: e instanceof CalcError ? e.message : "Cannot evaluate" };
    }
  });
}

/**
 * Compiles a graph function of x. Accepts "x^2", "y = x^2" and "f(x) = x^2". Returns null with a message if
 * it does not parse or uses a name other than x.
 */
export function compileFn(src: string): { fn: (x: number) => number } | { error: string } {
  const body = src.replace(/^\s*(y|[a-z]\s*\(\s*x\s*\))\s*=/i, "").trim();
  if (!body) return { error: "Empty" };
  try {
    const tree = parse(body);
    const probe = (x: number) => evaluate(tree, { x });
    probe(0.5); // surfaces unknown names now, not per point
    return { fn: probe };
  } catch (e) {
    return { error: e instanceof CalcError ? e.message : "Cannot parse" };
  }
}

/** Human formatting: up to 10 significant digits, thousands grouping, no float noise like 0.30000000000000004. */
export function fmtNum(v: number): string {
  if (Number.isNaN(v)) return "not a number";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e15 || abs < 1e-9) return v.toExponential(6).replace(/\.?0+e/, "e");
  const rounded = Number(v.toPrecision(12));
  const [int, frac] = String(Math.abs(rounded)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${v < 0 ? "−" : ""}${grouped}${frac ? `.${frac.slice(0, 10)}` : ""}`;
}
