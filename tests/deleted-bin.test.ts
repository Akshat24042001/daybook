// Nothing is ever lost: every delete on the platform keeps a full copy, the Deleted page lists it, Restore puts it
// back with everything that went with it, and History's Undo agrees with it. Also: deletes always reach History.
import { beforeEach, describe, expect, it } from "vitest";
import { actionStore, one, q } from "@/lib/db";
import { listDeleted, restoreDeleted } from "@/lib/bin";
import { createDeal, deleteDeal, logActivity } from "@/lib/sales/deals";
import { journaled, listActions, undoAction } from "@/lib/undo";
import { resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await q("truncate sales_deals, sales_interactions, deleted_rows, change_actions restart identity cascade");
});

const exists = async (tbl: string, id: number) => !!(await one(`select 1 from ${tbl} where id = $1`, [id]));
const dealWithNote = async (title: string) => {
  const id = await createDeal({ title, source: "outbound" });
  const note = await logActivity(id, { type: "note", body: `${title}: wants a booking bot` });
  return { id, note };
};

describe("every data table keeps what is deleted", () => {
  it("has the keeper on every table except machinery", async () => {
    const missing = await q<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and c.relname not in (select tbl from bin_skip)
          and exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary)
          and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'aa_bin')`);
    expect(missing.map((r) => r.relname)).toEqual([]);
    for (const t of ["sales_deals", "sales_interactions", "tasks", "contacts", "diary_entries", "scratch_items", "assistant_chats", "sales_captures"]) {
      expect(await one("select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = $1 and t.tgname = 'aa_bin'", [t]), t).toBeTruthy();
    }
  });

  it("a deleted lead is listed with its timeline and comes back whole, same ids", async () => {
    const { id, note } = await dealWithNote("Udaipur clinic");
    const { undo } = await journaled("web", () => deleteDeal(id));
    expect(await exists("sales_deals", id)).toBe(false);
    const [g] = await listDeleted();
    expect(g.noun).toBe("deal");
    expect(g.names).toEqual(["Udaipur clinic"]);
    expect(g.linked).toBeGreaterThanOrEqual(1);
    expect(g.source).toBe("App");
    const r = await restoreDeleted(g.grp);
    expect(r.label).toBe("Restored deal “Udaipur clinic”");
    expect(await exists("sales_deals", id)).toBe(true);
    expect(await exists("sales_interactions", note)).toBe(true);
    expect((await listDeleted())[0].restored).toBe(true);
    await expect(restoreDeleted(g.grp)).rejects.toThrow(/already back/);
    // the restore is in History and can itself be undone (the lead goes back to Deleted, not lost)
    const acts = await listActions();
    expect(acts[0].label).toBe("Restored deal “Udaipur clinic”");
    expect(acts.some((a) => a.id === undo!.id)).toBe(true);
    await undoAction(acts[0].id);
    expect(await exists("sales_deals", id)).toBe(false);
    expect((await listDeleted({ auto: true })).some((x) => !x.restored && x.names.includes("Udaipur clinic"))).toBe(true);
  });

  it("Undo in History and Restore agree", async () => {
    const { id } = await dealWithNote("Jaipur hotel");
    const { undo } = await journaled("web", () => deleteDeal(id));
    await undoAction(undo!.id);
    expect(await exists("sales_deals", id)).toBe(true);
    const g = (await listDeleted()).find((x) => x.names.includes("Jaipur hotel"))!;
    expect(g.restored).toBe(true);
  });

  it("keeps deletes made outside the app's actions too (jobs, cascades), shown under automatic clean-ups", async () => {
    const { id } = await dealWithNote("Background removal");
    await q("delete from sales_deals where id = $1", [id]);
    expect(await listDeleted()).toEqual([]);
    const g = (await listDeleted({ auto: true }))[0];
    expect(g.source).toBe("System");
    await restoreDeleted(g.grp);
    expect(await exists("sales_deals", id)).toBe(true);
  });

  it("asks to restore the parent first when it was deleted separately", async () => {
    const { id, note } = await dealWithNote("Parent first");
    await journaled("web", () => q("delete from sales_interactions where id = $1", [note]));
    await journaled("web", () => deleteDeal(id));
    const [dealGroup, noteGroup] = await listDeleted();
    expect(dealGroup.noun).toBe("deal");
    await expect(restoreDeleted(noteGroup.grp)).rejects.toThrow(/Restore that first/);
    await restoreDeleted(dealGroup.grp);
    await restoreDeleted(noteGroup.grp);
    expect(await exists("sales_interactions", note)).toBe(true);
  });

  it("search finds a deletion by name", async () => {
    const a = await dealWithNote("Mehta dental");
    const b = await dealWithNote("Shah textiles");
    await journaled("web", () => deleteDeal(a.id));
    await journaled("web", () => deleteDeal(b.id));
    expect((await listDeleted({ search: "dental" })).map((g) => g.names[0])).toEqual(["Mehta dental"]);
  });
});

describe("History sees every delete", () => {
  it("there is one action store per process, shared with the pool", () => {
    const g = globalThis as unknown as { __daybookActionStore?: unknown };
    expect(g.__daybookActionStore).toBe(actionStore);
  });
});
