import { beforeEach, describe, expect, it } from "vitest";
import { q } from "@/lib/db";
import { createDeal } from "@/lib/sales/deals";
import { ensureCompany, upsertPerson } from "@/lib/sales/identity";
import { authorProfile, dealQuickLinks, dedupe, radarQuickLinks, socialLinks, textContacts } from "@/lib/sales/quick-links";
import { seenIn } from "@/lib/sales/research";

beforeEach(async () => {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_radar_items restart identity cascade`);
});

describe("quick links from a post (no invention)", () => {
  it("builds author profiles only from the platform's own patterns", () => {
    expect(authorProfile("https://www.reddit.com/r/smallbusiness/comments/x", "u/clinic_owner")?.href).toBe("https://www.reddit.com/user/clinic_owner");
    expect(authorProfile("https://news.ycombinator.com/item?id=1", "pg")?.href).toBe("https://news.ycombinator.com/user?id=pg");
    expect(authorProfile("https://x.com/janedoe/status/123", null)?.href).toBe("https://x.com/janedoe");
    expect(authorProfile("https://www.linkedin.com/posts/rahul-mehta-123_ai-activity-1", null)?.href).toBe("https://www.linkedin.com/in/rahul-mehta-123");
    expect(authorProfile("https://www.upwork.com/jobs/x", "someone")).toBeNull();
  });

  it("copies contacts exactly and never turns dates, prices or ids into phone numbers", () => {
    const t = textContacts("Email me at Jane@Acme.co or call +44 20 7946 0958. Budget 5000000, posted 2026-11-06, order 1234567890. Site: https://acme.co/about. WhatsApp: wa.me/971501234567. Test: user@example.com");
    const by = (k: string) => t.filter((x) => x.kind === k).map((x) => x.value ?? x.href);
    expect(by("email")).toEqual(["jane@acme.co"]);
    expect(by("call")).toEqual(["+442079460958"]);
    expect(by("whatsapp")).toContain("+971501234567");
    expect(by("website")).toEqual(["https://acme.co/about"]);
    expect(t.every((x) => x.source === "post")).toBe(true);
  });

  it("reads research social profiles and drops duplicates across groups", () => {
    expect(socialLinks("linkedin: https://linkedin.com/company/acme; instagram: https://instagram.com/acme", "website").map((l) => l.label)).toEqual(["LinkedIn page", "Instagram"]);
    const g = dedupe([
      { title: "A", links: [{ kind: "website", label: "x", value: null, href: "https://www.acme.co/", source: "saved" }] },
      { title: "B", links: [{ kind: "website", label: "x", value: null, href: "https://acme.co", source: "post" }] },
    ]);
    expect(g.map((x) => x.title)).toEqual(["A"]);
  });

  it("keeps a LinkedIn profile or email from research only if it was literally in what was read", () => {
    const evidence = "- Rahul Mehta | https://in.linkedin.com/in/rahul-mehta-123 | Ops head at Noor. Contact: rahul@noor.ae";
    expect(seenIn(evidence, "https://www.linkedin.com/in/rahul-mehta-123")).toBe(true);
    expect(seenIn(evidence, "https://www.linkedin.com/in/rahulmehta")).toBe(false);
    expect(seenIn(evidence, "rahul@noor.ae")).toBe(true);
    expect(seenIn(evidence, "r.mehta@noor.ae")).toBe(false);
  });
});

describe("quick links from what Daybook holds", () => {
  it("a researched radar lead gets post, company and people links, with guesses labelled", async () => {
    const companyId = (await ensureCompany("Noor Jewels", { website: "https://noorjewels.ae" }))!;
    await q("update sales_companies set enriched_at = now(), enrichment = $2 where id = $1", [companyId, JSON.stringify({
      generic_email: { v: "info@noorjewels.ae" }, public_phones: { v: "+971 4 555 0101" }, whatsapp_number: { v: "+971501234567" },
      social_profiles: { v: "instagram: https://instagram.com/noorjewels" }, address: { v: "Gold Souk, Deira, Dubai" },
    })]);
    const pid = await upsertPerson({ name: "Fatima Noor", title: "Founder", company_id: companyId });
    await q("update sales_people set is_decision_maker = true, linkedin = 'https://www.linkedin.com/in/fatima-noor', enrichment = $2 where id = $1", [pid, JSON.stringify({ email_guess: { v: "fatima.noor@noorjewels.ae", est: true } })]);
    const item = (await q<{ id: number }>("insert into sales_radar_items (url, url_hash, title, body, author, company_id) values ('https://www.reddit.com/r/x/comments/1','h1','Need an inventory app','DM me or mail ops@noorjewels.ae','u/noorops',$1) returning id", [companyId]))[0].id;
    const groups = (await radarQuickLinks([item]))[item];
    const titles = groups.map((g) => g.title);
    expect(titles[0]).toBe("Where they posted");
    expect(titles).toContain("Written in their post");
    expect(titles).toContain("Noor Jewels");
    const all = groups.flatMap((g) => g.links);
    expect(all.find((l) => l.kind === "profile")?.href).toBe("https://www.reddit.com/user/noorops");
    expect(all.find((l) => l.value === "ops@noorjewels.ae")?.source).toBe("post");
    expect(all.find((l) => l.kind === "whatsapp" && l.source === "website")?.href).toBe("https://wa.me/971501234567");
    expect(all.find((l) => l.kind === "map")?.href).toContain("google.com/maps");
    const guess = all.find((l) => l.value === "fatima.noor@noorjewels.ae")!;
    expect(guess.source).toBe("guess");
    expect(guess.label).toBe("Likely email");
  });

  it("a lead with no company says so instead of showing nothing", async () => {
    const item = (await q<{ id: number }>("insert into sales_radar_items (url, url_hash, title) values ('https://news.ycombinator.com/item?id=9','h2','Seeking freelancer') returning id"))[0].id;
    const groups = (await radarQuickLinks([item]))[item];
    expect(groups.find((g) => g.title === "The company")?.note).toMatch(/does not name a company/);
  });

  it("a deal shows its contact first, then the company and the referrer", async () => {
    const companyId = (await ensureCompany("Zeta Logistics", { website: "zeta.io" }))!;
    const pid = await upsertPerson({ name: "Ravi Kumar", phone: "+919820011122", email: "ravi@zeta.io", company_id: companyId });
    const ref = await upsertPerson({ name: "Vikram Shah", phone: "+919820000000" });
    const id = await createDeal({ person_id: pid, company_id: companyId, referrer_id: ref, title: "Zeta app" });
    const groups = await dealQuickLinks(id);
    expect(groups[0].title).toMatch(/^Ravi Kumar/);
    expect(groups[0].links.map((l) => l.kind)).toEqual(expect.arrayContaining(["call", "whatsapp", "email"]));
    expect(groups.some((g) => g.title === "Zeta Logistics")).toBe(true);
    expect(groups.at(-1)?.title).toBe("Vikram Shah · referred you");
  });
});
