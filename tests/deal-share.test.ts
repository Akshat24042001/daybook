// Sharing a deal: contacts first, then where it stands, the next step, the need and the conversation; four forms.
import { beforeEach, describe, expect, it } from "vitest";
import { one, q } from "@/lib/db";
import { createDeal } from "@/lib/sales/deals";
import { dealShare } from "@/lib/sales/deal-share";

beforeEach(async () => {
  await q("truncate sales_deals, sales_people, sales_companies, sales_interactions restart identity cascade");
});

describe("sharing a deal", () => {
  it("puts the contacts first and carries the next step, the need and the latest conversation", async () => {
    const co = (await one<{ id: number }>("insert into sales_companies (name, website, phone, city, country) values ('Bliss Perfumes', 'blissperfumes.ae', '+971 4 555 0100', 'Dubai', 'UAE') returning id"))!.id;
    const pe = (await one<{ id: number }>("insert into sales_people (full_name, title, phones, emails, company_id) values ('Farah Qureshi', 'Founder', $1, $2, $3) returning id", [["+971 50 123 4567"], ["farah@blissperfumes.ae"], co]))!.id;
    const id = await createDeal({ title: "Bliss WhatsApp bot", company_id: co, person_id: pe, requirements: "A WhatsApp bot for 3 shops" });
    await q("update sales_deals set next_action = 'Send the demo' where id = $1", [id]);
    await q("insert into sales_interactions (deal_id, channel, direction, body) values ($1, 'whatsapp', 'in', 'Can it take orders too?')", [id]);
    const s = await dealShare(id);
    expect(s.full.indexOf("## Contacts")).toBeLessThan(s.full.indexOf("## What they need"));
    expect(s.full).toMatch(/Farah Qureshi \(Founder\): \+971 50 123 4567 · farah@blissperfumes\.ae/);
    expect(s.full).toMatch(/Bliss Perfumes \(office\): \+971 4 555 0100/);
    expect(s.full).toMatch(/## Next step\nSend the demo/);
    expect(s.full).toMatch(/whatsapp, them: Can it take orders too\?/);
    expect(s.whatsapp).toMatch(/\*Contact:\*/);
    expect(s.claude).toMatch(/Never invent/);
    expect(JSON.parse(s.json).people[0].name).toBe("Farah Qureshi");
    expect(s.filename).toMatch(/^deal-\d+-bliss-whatsapp-bot\.md$/);
  });
});
