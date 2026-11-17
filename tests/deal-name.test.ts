// A deal saved with only the person's name gets a real name from what you wrote; a name you gave is never touched.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ project: "Namlink" as string | null, user: "" }));
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return { ...real, llmConfigured: () => true, llmJson: vi.fn(async (_s: string, user: string) => { ai.user = user; return { project: ai.project }; }) };
});

import { one, q } from "@/lib/db";
import { createDeal, dealName, nameDeal, updateDeal } from "@/lib/sales/deals";
import { upsertPerson } from "@/lib/sales/identity";

beforeEach(async () => {
  await q("truncate sales_deals, sales_people, sales_companies, sales_jobs restart identity cascade");
  ai.project = "Namlink";
});

describe("naming a deal", () => {
  it("reads like '<who>: <project>'", () => {
    expect(dealName("Krina Mehta", "Namlink.")).toBe("Krina Mehta: Namlink");
    expect(dealName("Krina Mehta", null)).toBe("Krina Mehta");
  });

  it("names a deal saved as 'Krina Mehta' from your note, once", async () => {
    const p = await upsertPerson({ name: "Krina Mehta" });
    const id = await createDeal({ person_id: p, requirements: "I'm working on Namlink with Krina Mehta" });
    expect((await one<{ title: string }>("select title from sales_deals where id = $1", [id]))!.title).toBe("Krina Mehta");
    expect(await nameDeal(id)).toBe("Krina Mehta: Namlink");
    expect(ai.user).toContain("working on Namlink");
    expect((await one<{ title: string }>("select title from sales_deals where id = $1", [id]))!.title).toBe("Krina Mehta: Namlink");
  });

  it("never renames a deal you named or renamed", async () => {
    const p = await upsertPerson({ name: "Krina Mehta" });
    const id = await createDeal({ person_id: p, title: "Website rebuild", requirements: "Namlink" });
    expect(await nameDeal(id)).toBeNull();
    const id2 = await createDeal({ person_id: p, requirements: "Namlink app" });
    await updateDeal(id2, { title: "My own name" });
    expect(await nameDeal(id2)).toBeNull();
    // nothing usable in the note: stays as it is
    const id3 = await createDeal({ person_id: p, requirements: "call later" });
    ai.project = null;
    expect(await nameDeal(id3)).toBeNull();
  });
});
