import { describe, expect, it } from "vitest";
import { q } from "@/lib/db";
import { bootstrap } from "@/lib/bootstrap";

describe("startup migrations", () => {
  it("two cold starts at the same moment apply a migration exactly once and touch nothing else", async () => {
    await q("insert into contacts (name) values ('Bootstrap check')");
    const before = await q<{ n: number; h: string }>("select count(*)::int as n, md5(string_agg(c::text, '|' order by id)) as h from contacts c");
    // pretend the Sales migration has not run yet
    const sales = await q<{ t: string }>("select table_name as t from information_schema.tables where table_schema = 'public' and table_name like 'sales\\_%'");
    for (const { t } of sales) await q(`drop table if exists ${t} cascade`);
    await q("delete from schema_migrations where name = '026_sales.sql'");

    await Promise.all([bootstrap(), bootstrap(), bootstrap()]);

    const applied = await q("select name from schema_migrations where name = '026_sales.sql'");
    expect(applied).toHaveLength(1);
    const stages = await q<{ n: number }>("select count(*)::int as n from sales_stages");
    expect(stages[0].n).toBe(15);
    const after = await q<{ n: number; h: string }>("select count(*)::int as n, md5(string_agg(c::text, '|' order by id)) as h from contacts c");
    expect(after).toEqual(before);
    await q("delete from contacts where name = 'Bootstrap check'");
  });
});
