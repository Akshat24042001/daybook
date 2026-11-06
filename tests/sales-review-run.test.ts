import { beforeEach, describe, expect, it } from "vitest";
import { weeklyReview } from "@/lib/sales/review";
import { resetDb } from "./helpers";

describe("sales weekly review", () => {
  beforeEach(resetDb);
  it("runs end to end on an empty database (it used to crash on a stray bind parameter)", async () => {
    const r = await weeklyReview(7);
    expect(r.started).toBe(0);
    expect(r.moves_overdue).toBe(0);
    expect((await weeklyReview(30)).by_channel).toEqual([]);
  });
});
