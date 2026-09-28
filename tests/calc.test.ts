import { describe, expect, it } from "vitest";
import { calc, compileFn, fmtNum, runTape } from "@/lib/calc";

describe("scratchpad calculator", () => {
  it("follows normal precedence", () => {
    expect(calc("2 + 3 * 4")).toBe(14);
    expect(calc("(2 + 3) * 4")).toBe(20);
    expect(calc("2^3^2")).toBe(512);
    expect(calc("-2^2")).toBe(-4);
    expect(calc("10 / 4")).toBe(2.5);
    expect(calc("7 mod 3")).toBe(1);
  });

  it("reads the way people type", () => {
    expect(calc("2(3 + 4)")).toBe(14);
    expect(calc("3 × 4 ÷ 2 − 1")).toBe(5);
    expect(calc("5!")).toBe(120);
    expect(calc("sqrt 16")).toBe(4);
    expect(calc("√(9)")).toBe(3);
    expect(calc("1_000 * 3")).toBe(3000);
    expect(calc("sin(30deg)")).toBeCloseTo(0.5, 12);
    expect(calc("2pi")).toBeCloseTo(2 * Math.PI, 12);
  });

  it("handles percentages like a desk calculator", () => {
    expect(calc("18% of 2400")).toBeCloseTo(432, 9);
    expect(calc("2400 + 10%")).toBeCloseTo(2640, 9);
    expect(calc("2400 - 25%")).toBeCloseTo(1800, 9);
    expect(calc("50%")).toBe(0.5);
  });

  it("runs a tape with variables, ans, comments and errors", () => {
    const r = runTape(["rent = 18000", "food = 6500  # rough", "rent + food", "ans / 2", "", "# totals", "2 +", "bogus * 2", "3 * 3 ="]);
    expect(r[0]).toEqual({ kind: "value", value: 18000, name: "rent" });
    expect(r[1]).toEqual({ kind: "value", value: 6500, name: "food" });
    expect(r[2]).toEqual({ kind: "value", value: 24500 });
    expect(r[3]).toEqual({ kind: "value", value: 12250 });
    expect(r[4]).toEqual({ kind: "empty" });
    expect(r[5]).toEqual({ kind: "comment" });
    expect(r[6].kind).toBe("error");
    expect(r[7]).toEqual({ kind: "error", error: 'Unknown "bogus"' });
    expect(r[8]).toEqual({ kind: "value", value: 9 });
  });

  it("refuses to assign built-in names", () => {
    expect(runTape(["pi = 3"])[0]).toEqual({ kind: "error", error: '"pi" is a built-in name' });
  });

  it("compiles graph functions of x", () => {
    const f = compileFn("y = 2x^2 + 1");
    expect("fn" in f && f.fn(3)).toBe(19);
    const g = compileFn("f(x) = sin(x) / x");
    expect("fn" in g && g.fn(Math.PI / 2)).toBeCloseTo(2 / Math.PI, 12);
    expect(compileFn("x + t")).toEqual({ error: 'Unknown "t"' });
  });

  it("formats numbers without float noise", () => {
    expect(fmtNum(0.1 + 0.2)).toBe("0.3");
    expect(fmtNum(1234567.5)).toBe("1,234,567.5");
    expect(fmtNum(-42)).toBe("−42");
    expect(fmtNum(1 / 0)).toBe("∞");
  });
});
