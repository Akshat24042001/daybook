// No wrong contacts: a phone or email is kept only with proof (a real page about this lead), never from an AI's own
// words, never another country's number, never a web designer's footer credit, never another company's email. And the
// contacts saved before this rule are taken out of sight once.
import { beforeEach, describe, expect, it } from "vitest";
import { mentions, ownSite, verifyEmails, verifyPhones, wrongCountry } from "@/lib/sales/contact-verify";
import { extractContacts } from "@/lib/sales/research-extract";
import { dropSiteContacts, proofSources, siteIsTheirs, strictSiteContacts } from "@/lib/sales/research";
import { groundIdentity } from "@/lib/sales/behind-post";
import { ownContact } from "@/lib/sales/radar-prep";
import { scrubContacts } from "@/lib/sales/contact-scrub";
import { one, q } from "@/lib/db";

const lead = { company: "Bliss Perfumes LLC", domain: "blissperfumes.ae", person: "Farah Qureshi", country: "United Arab Emirates" };

describe("a phone is kept only with proof", () => {
  it("their own website proves it", () => {
    const v = verifyPhones(["+971 4 555 0100"], [{ url: "https://blissperfumes.ae/contact", text: "Call us on +971 4 555 0100" }], lead);
    expect(v).toEqual([{ kind: "phone", value: "+971 4 555 0100", url: "https://blissperfumes.ae/contact", owner: "company" }]);
  });

  it("an AI's own summary never proves a number, however sure it sounds", () => {
    expect(verifyPhones(["+971 50 111 2222"], [{ url: "Google search (Gemini)", text: "Bliss Perfumes LLC: call Farah Qureshi on +971 50 111 2222", ai: true }], lead)).toEqual([]);
    expect(verifyPhones(["+971 50 111 2222"], [{ url: "https://x.example", text: "Bliss Perfumes LLC: +971 50 111 2222", ai: true }], lead)).toEqual([]);
  });

  it("a number on a page about another business is that business's number", () => {
    const page = { url: "https://directory.example/dubai", text: "Bliss Perfumes LLC, Deira. " + "x".repeat(800) + " Rose Oud Trading: +971 50 999 8888" };
    expect(verifyPhones(["+971 50 999 8888"], [page], lead)).toEqual([]);
    // the same number right next to their name is theirs
    expect(verifyPhones(["+971 50 999 8888"], [{ url: "https://directory.example/bliss", text: "Bliss Perfumes LLC, Deira. Phone +971 50 999 8888" }], lead)).toHaveLength(1);
  });

  it("a number from another country is someone else's: a +91 number for a Dubai business is dropped", () => {
    expect(wrongCountry("+91 98200 11111", "United Arab Emirates")).toBe(true);
    expect(wrongCountry("+971 50 111 2222", "UAE")).toBe(false);
    expect(verifyPhones(["+91 98200 11111"], [{ url: "https://blissperfumes.ae", text: "Bliss Perfumes LLC +91 98200 11111" }], lead)).toEqual([]);
  });

  it("a web designer's credit in the footer is the designer's number", () => {
    const text = "Bliss Perfumes LLC. All rights reserved. Website designed & developed by PixelCraft Studio +971 55 777 6666";
    expect(verifyPhones(["+971 55 777 6666"], [{ url: "https://blissperfumes.ae", text }], lead)).toEqual([]);
    const html = `<p>Call <a href="tel:+97145550100">+971 4 555 0100</a></p><footer>Designed by PixelCraft <a href="tel:+971557776666">+971 55 777 6666</a></footer>`;
    expect(extractContacts(html, "https://blissperfumes.ae").phones).toEqual(["+97145550100"]);
  });

  it("the person's own number is the one written next to their name; the rest is the office line", () => {
    const text = "Bliss Perfumes LLC. Office: +971 4 555 0100. " + "y".repeat(300) + " Farah Qureshi, Founder, mobile +971 50 123 4567";
    const v = verifyPhones(["+971 4 555 0100", "+971 50 123 4567"], [{ url: "https://blissperfumes.ae/team", text }], lead);
    expect(v.find((x) => x.value.includes("555"))?.owner).toBe("company");
    expect(v.find((x) => x.value.includes("123 4567"))?.owner).toBe("person");
  });
});

describe("an email is kept only with proof", () => {
  it("at their domain on a page about them; another company's address never", () => {
    const src = [{ url: "https://blissperfumes.ae/contact", text: "Bliss Perfumes LLC: farah@blissperfumes.ae, info@blissperfumes.ae, hello@pixelcraft.ae" }];
    const v = verifyEmails(["farah@blissperfumes.ae", "info@blissperfumes.ae", "hello@pixelcraft.ae"], src, lead);
    expect(v.map((x) => [x.value, x.owner])).toEqual([["farah@blissperfumes.ae", "person"], ["info@blissperfumes.ae", "company"]]);
  });

  it("an email nobody wrote on a real page is dropped", () => {
    expect(verifyEmails(["farah@blissperfumes.ae"], [{ url: "https://blissperfumes.ae", text: "Bliss Perfumes LLC" }], lead)).toEqual([]);
  });
});

describe("the business behind a post", () => {
  const proof = (text: string, url = "https://www.linkedin.com/posts/x") => ({ sources: [{ url, text }, { url: "Google search (Gemini)", text: "Bliss Perfumes LLC, Farah Qureshi +971 50 444 3333", ai: true }], post: { url: "https://reddit.com/r/x", text: "Need a WhatsApp bot for our perfume shops in Dubai" }, country: "United Arab Emirates" });

  it("keeps only proven contacts, and the AI's summary does not prove the business either", () => {
    const id = groundIdentity({ company: "Bliss Perfumes LLC", website: "blissperfumes.ae", person: "Farah Qureshi", phones: ["+971 50 444 3333", "+971 4 555 0100"], emails: [], confidence: "high" },
      "", proof("Bliss Perfumes LLC (blissperfumes.ae), Dubai. Call +971 4 555 0100. Farah Qureshi runs it."));
    expect(id.phones).toEqual(["+971 4 555 0100"]);
    expect(id.verified?.[0]).toMatchObject({ url: "https://www.linkedin.com/posts/x" });
    const fake = groundIdentity({ company: "Bliss Perfumes LLC", confidence: "high" }, "", { ...proof("nothing here"), sources: [{ url: "Google search (Gemini)", text: "Bliss Perfumes LLC", ai: true }] });
    expect(fake.company).toBeNull();
  });

  it("a number the poster wrote in the post is theirs", () => {
    const id = groundIdentity({ company: null, phones: ["+971 50 222 1111"], confidence: "low" }, "", { sources: [], post: { url: "https://reddit.com/r/x", text: "WhatsApp me on +971 50 222 1111" }, country: "United Arab Emirates" });
    expect(id.verified).toEqual([{ kind: "phone", value: "+971 50 222 1111", url: "https://reddit.com/r/x", owner: "person" }]);
    expect(ownContact(id, "phone")).toBe("+971 50 222 1111");
  });

  it("the office line is never given as the decision maker's own number", () => {
    expect(ownContact({ verified: [{ kind: "phone", value: "+971 4 555 0100", url: "u", owner: "company" }] }, "phone")).toBeNull();
  });
});

describe("company research contacts", () => {
  it("only phones from their country and emails at their domain; a website only research guessed gives none", () => {
    const c = strictSiteContacts({ emails: [{ email: "info@blissperfumes.ae", kind: "generic", page: "p" }, { email: "sales@otherco.com", kind: "generic", page: "p" }], phones: ["+97145550100", "+919820011111"], socials: {}, addresses: [], org: {} }, { country: "United Arab Emirates", domain: "blissperfumes.ae" });
    expect(c.phones).toEqual(["+97145550100"]);
    expect(c.emails.map((e) => e.email)).toEqual(["info@blissperfumes.ae"]);
    expect(siteIsTheirs({}, "you", null)).toBe(true);
    expect(siteIsTheirs({ identity_match: { v: "likely" } }, "research", { score: 5 })).toBe(false);
    expect(siteIsTheirs({ identity_match: { v: "confirmed" } }, "research", null)).toBe(true);
    const out = { public_phones: { v: "+97145550100" }, public_emails: { v: "a@b.ae, c@b.ae" } };
    expect(dropSiteContacts(out)).toBe(3);
    expect(out.public_phones.v).toBeNull();
  });

  it("reads each saved page and search result as its own source", () => {
    const s = proofSources(["[page https://a.ae/contact] call +971 4 1", "[search: x]\n- Bliss | https://b.ae/x | snippet here"]);
    expect(s).toEqual([{ url: "https://a.ae/contact", text: "call +971 4 1" }, { url: "https://b.ae/x", text: "Bliss\nsnippet here" }]);
    expect(ownSite("https://www.shop.blissperfumes.ae/x", "blissperfumes.ae")).toBe(true);
    expect(mentions("we are Bliss Perfumes", { company: "Bliss Perfumes LLC" }).company.length).toBe(1);
  });
});

describe("the one-time clean-up of old contacts", () => {
  beforeEach(async () => {
    await q("truncate sales_radar_items, sales_jobs, sales_companies, sales_people, sales_deals, sales_interactions restart identity cascade");
  });

  it("hides unproven contacts on leads and people, keeps what the poster wrote, and clears a guessed website's contacts", async () => {
    const pe = (await one<{ id: number }>("insert into sales_people (full_name, phones, emails) values ('Farah', $1, $2) returning id", [["+91 90000 12345", "+971 50 777 1111"], ["wrong@else.com"]]))!.id;
    const it = (await one<{ id: number }>(`insert into sales_radar_items (url, url_hash, title, body, status, person_id, found_at, identity) values ('u', 'h', 'Need a bot', 'Call me on +971 50 777 1111', 'qualified', $1, now(), $2) returning id`,
      [pe, JSON.stringify({ status: "found", phones: ["+91 90000 12345", "+971 50 777 1111"], emails: ["wrong@else.com"], evidence: [], note: "" })]))!.id;
    const co = (await one<{ id: number }>("insert into sales_companies (name, country, website_source, enrichment) values ('Bliss', 'United Arab Emirates', 'research', $1) returning id",
      [JSON.stringify({ public_phones: { v: "+97145550100", src: "their website" }, identity_match: { v: "likely" } })]))!.id;
    const r = await scrubContacts();
    expect(r).toMatchObject({ radar: 1, people: 1, companies: 1, requeued: 1 });
    const id = (await one<{ identity: { phones: string[]; emails: string[]; unverified: { phones: string[] } } }>("select identity from sales_radar_items where id = $1", [it]))!.identity;
    expect(id.phones).toEqual(["+971 50 777 1111"]);
    expect(id.emails).toEqual([]);
    expect(id.unverified.phones).toEqual(["+91 90000 12345"]);
    const p = (await one<{ phones: string[]; emails: string[] }>("select phones, emails from sales_people where id = $1", [pe]))!;
    expect(p).toEqual({ phones: ["+971 50 777 1111"], emails: [] });
    expect((await one<{ e: { public_phones: { v: unknown } } }>("select enrichment as e from sales_companies where id = $1", [co]))!.e.public_phones.v).toBeNull();
    // run again: nothing left to do
    expect(await scrubContacts()).toMatchObject({ radar: 0, people: 0, companies: 0 });
  });
});
