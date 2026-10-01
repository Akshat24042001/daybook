import { describe, expect, it } from "vitest";
import { EXERCISES, GROUND, TOP, catalogFor, poseAt, propBoxes, solve, toBody3, type Pt } from "@/lib/exercise-catalog";

const points = (s: ReturnType<typeof solve>): Pt[] => [
  s.head, s.neck, s.hip,
  ...s.arms.flat(),
  ...s.legs.flatMap((l) => l.filter((p): p is Pt => p !== null)),
];

describe("exercise catalogue", () => {
  it("has at least 25 exercises with unique keys and full instructions", () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(EXERCISES.map((e) => e.key)).size).toBe(EXERCISES.length);
    for (const e of EXERCISES) {
      expect(e.steps.length, e.key).toBeGreaterThanOrEqual(3);
      expect(e.avoid.length, e.key).toBeGreaterThanOrEqual(1);
      expect(e.amount, e.key).toBeGreaterThan(0);
      expect(e.rig.frames.length, e.key).toBeGreaterThanOrEqual(2);
    }
  });

  it("matches the names people type", () => {
    expect(catalogFor("Push-ups")?.key).toBe("pushup");
    expect(catalogFor("pushup")?.key).toBe("pushup");
    expect(catalogFor("Squats")?.key).toBe("squat");
    expect(catalogFor("Lunges")?.key).toBe("lunge");
    expect(catalogFor("lunge")?.key).toBe("lunge");
    expect(catalogFor("Crunch")?.key).toBe("crunch");
    expect(catalogFor("Calf raises")?.key).toBe("calfraise");
    expect(catalogFor("Tricep dips")?.key).toBe("chairdip");
    expect(catalogFor("Plank")?.key).toBe("plank");
    expect(catalogFor("Juggling")).toBeNull();
    // every catalogue name finds itself
    for (const e of EXERCISES) expect(catalogFor(e.name)?.key, e.name).toBe(e.key);
  });

  it("keeps every figure on screen and never through the floor", () => {
    for (const e of EXERCISES) {
      for (let i = 0; i <= 40; i++) {
        const s = solve(e.rig, poseAt(e.rig, i / 40));
        for (const [x, y] of points(s)) {
          expect(Number.isFinite(x) && Number.isFinite(y), e.key).toBe(true);
          expect(x, `${e.key} x`).toBeGreaterThanOrEqual(0);
          expect(x, `${e.key} x`).toBeLessThanOrEqual(120);
          expect(y, `${e.key} y`).toBeGreaterThanOrEqual(TOP);
          expect(y, `${e.key} below the floor at ${i}/40`).toBeLessThanOrEqual(GROUND + 2.5);
        }
      }
    }
  });

  it("puts hands and feet that should touch the floor on the floor", () => {
    for (const e of EXERCISES) {
      for (const f of e.rig.frames) {
        const s = solve(e.rig, f);
        const pairs: [Pt, Pt][] = [[f.hN, s.arms[0][2]], [f.hF, s.arms[1][2]], [f.fN, s.legs[0][2]], [f.fF, s.legs[1][2]]];
        for (const [target, got] of pairs) {
          if (target[1] < GROUND - 0.5 || f.lift) continue;
          expect(Math.hypot(target[0] - got[0], target[1] - got[1]), `${e.key} contact`).toBeLessThan(2);
        }
      }
    }
  });

  it("lifts every figure into 3D with both sides apart and nothing under the floor", () => {
    for (const e of EXERCISES) {
      for (let i = 0; i <= 20; i++) {
        const b = toBody3(e.rig, solve(e.rig, poseAt(e.rig, i / 20)));
        const pts = [b.head, b.neck, b.hip, ...b.arms.flat(), ...b.legs.flat().filter((p) => p !== null)];
        for (const p of pts) {
          expect(p.every(Number.isFinite), e.key).toBe(true);
          expect(p[1], `${e.key} below the floor`).toBeGreaterThanOrEqual(-2.5);
        }
        // the two shoulders are apart, so turning the figure shows a body, not a flat drawing
        expect(Math.hypot(...b.arms[0][0].map((v, k) => v - b.arms[1][0][k])), e.key).toBeGreaterThan(6);
      }
      for (const box of propBoxes(e.rig)) expect(box[0] < box[1] && box[2] <= box[3] && box[4] < box[5], e.key).toBe(true);
    }
  });
});
