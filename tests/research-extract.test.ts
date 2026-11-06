import { describe, expect, it } from "vitest";
import {
  ageYears, classifyMx, extractContacts, extractEmails, extractJsonLd, extractPhones, extractSocials, guessEmail, learnEmailPattern, mergeContacts, parseRdap, parseSpf,
} from "@/lib/sales/research-extract";

const PAGE = `
<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"LocalBusiness","name":"Acme Freight","telephone":"+971 4 555 0100","email":"hello@acmefreight.com",
 "foundingDate":"2012","numberOfEmployees":{"value":85},"founder":{"name":"Aisha Khan"},"aggregateRating":{"ratingValue":4.6,"reviewCount":212},
 "address":{"streetAddress":"Unit 4, Al Quoz","addressLocality":"Dubai","addressCountry":"AE"}}]}</script></head>
<body>
 <a href="mailto:sales@acmefreight.com?subject=Hi">Sales</a> Reach Aisha at aisha.khan@acmefreight.com or noreply@acmefreight.com
 <img src="logo@2x.png"> <span>user@example.com</span> sentry@sentry.wixpress.com
 <a href="tel:+971-4-555-0100">Call</a> Dubai office +971 50 123 4567 · 0000000000
 <a href="https://www.linkedin.com/company/acme-freight/">in</a> <a href="https://twitter.com/intent/tweet?text=x">share</a>
 <a href="https://x.com/acmefreight">x</a> <a href="https://www.instagram.com/acmefreight/?hl=en">ig</a> <a href="https://wa.me/971501234567">wa</a>
</body></html>`;

describe("pulling contact details off a page", () => {
  it("finds real emails, classifies them, and ignores junk", () => {
    const e = extractEmails("Write to Aisha.Khan@AcmeFreight.com, info@acmefreight.com; noreply@x.com user@example.com me@sentry.io logo@2x.png", "/contact");
    expect(e.map((x) => `${x.email}:${x.kind}`)).toEqual(["aisha.khan@acmefreight.com:personal", "info@acmefreight.com:generic"]);
  });

  it("reads obfuscated addresses", () => {
    expect(extractEmails("sales [at] acme.co.uk and boss&#64;acme.co.uk", "/").map((x) => x.email)).toEqual(["sales@acme.co.uk", "boss@acme.co.uk"]);
  });

  it("finds phones from tel: links and visible numbers, without repeats or filler", () => {
    const p = extractPhones(PAGE);
    expect(p).toHaveLength(2);
    expect(p[0]).toBe("+971-4-555-0100".replace(/-/g, ""));
    expect(p.some((x) => x.replace(/\D/g, "").endsWith("501234567"))).toBe(true);
  });

  it("finds social profiles but not share buttons", () => {
    const s = extractSocials(PAGE);
    expect(s).toMatchObject({ linkedin: "https://www.linkedin.com/company/acme-freight", x: "https://x.com/acmefreight", instagram: "https://www.instagram.com/acmefreight", whatsapp: "https://wa.me/971501234567" });
    expect(Object.keys(s)).not.toContain("twitter");
  });

  it("reads what the site says about itself in schema.org data", () => {
    const { org, addresses } = extractJsonLd(PAGE);
    expect(org).toMatchObject({ name: "Acme Freight", telephone: "+971 4 555 0100", foundingDate: "2012", employees: 85, founders: ["Aisha Khan"], rating: { value: 4.6, count: 212 } });
    expect(addresses).toEqual(["Unit 4, Al Quoz, Dubai, AE"]);
    expect(extractJsonLd("<script type=\"application/ld+json\">{broken</script>")).toEqual({ org: {}, addresses: [] });
  });

  it("puts one page together and merges several without repeats", () => {
    const a = extractContacts(PAGE, "https://acmefreight.com/contact");
    expect(a.emails.map((e) => e.email).sort()).toEqual(["aisha.khan@acmefreight.com", "hello@acmefreight.com", "sales@acmefreight.com"]);
    const b = extractContacts(`<a href="mailto:SALES@acmefreight.com">x</a> <a href="tel:+971555550100">c</a> <a href="https://github.com/acmefreight">gh</a>`, "https://acmefreight.com/about");
    const m = mergeContacts([a, b]);
    expect(m.emails.filter((e) => e.email === "sales@acmefreight.com")).toHaveLength(1);
    expect(m.phones.filter((p) => p.replace(/\D/g, "").endsWith("45550100"))).toHaveLength(1);
    expect(m.socials.github).toBe("https://github.com/acmefreight");
    expect(m.org.name).toBe("Acme Freight");
  });
});

describe("working out email addresses", () => {
  it("learns how a company writes its emails from a named colleague, and guesses for others", () => {
    const emails = [{ email: "aisha.khan@acmefreight.com" }, { email: "info@acmefreight.com" }];
    expect(learnEmailPattern(emails, ["Aisha Khan"], "acmefreight.com")).toBe("first.last");
    expect(guessEmail("Omar Al-Mansoori", "first.last", "acmefreight.com")).toBe("omar.almansoori@acmefreight.com");
    expect(guessEmail("José García", "flast", "acme.com")).toBe("jgarcia@acme.com");
    expect(learnEmailPattern([{ email: "akhan@acme.com" }], ["Aisha Khan"], "acme.com")).toBe("flast");
    expect(learnEmailPattern(emails, ["Someone Else"], "acmefreight.com")).toBeNull();
    expect(learnEmailPattern(emails, ["Aisha Khan"], "other.com")).toBeNull();
    expect(guessEmail("Madonna", "first.last", "x.com")).toBeNull();
  });
});

describe("domain facts", () => {
  it("names the email provider and the sending tools", () => {
    expect(classifyMx(["aspmx.l.google.com.", "alt1.aspmx.l.google.com."])).toBe("Google Workspace");
    expect(classifyMx(["acme-com.mail.protection.outlook.com."])).toBe("Microsoft 365");
    expect(classifyMx(["mx.zoho.in."])).toBe("Zoho Mail");
    expect(classifyMx(["mail.tinyhost.example."])).toBe("mail.tinyhost.example");
    expect(classifyMx([])).toBeNull();
    expect(parseSpf(['"v=spf1 include:_spf.google.com include:sendgrid.net include:servers.mcsv.net ~all"', '"google-site-verification=abc"'])).toEqual(["Google", "SendGrid", "Mailchimp"]);
    expect(parseSpf(['"google-site-verification=abc"'])).toEqual([]);
  });

  it("reads a domain registration and computes its age", () => {
    const r = parseRdap({
      events: [{ eventAction: "registration", eventDate: "2014-03-02T10:00:00Z" }, { eventAction: "expiration", eventDate: "2027-03-02T10:00:00Z" }],
      entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "GoDaddy.com, LLC"]]] }],
      nameservers: [{ ldhName: "NS1.EXAMPLE.COM" }],
    });
    expect(r).toEqual({ registered: "2014-03-02", expires: "2027-03-02", registrar: "GoDaddy.com, LLC", nameservers: ["ns1.example.com"] });
    expect(ageYears("2014-03-02", new Date("2026-03-02"))).toBe(12);
    expect(ageYears(null)).toBeNull();
    expect(parseRdap(null)).toEqual({ registered: null, expires: null, registrar: null, nameservers: [] });
  });
});
