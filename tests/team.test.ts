import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { one, q, repStore } from "@/lib/db";
import { addCommitment, createDeal, logActivity } from "@/lib/sales/deals";
import { NotFound } from "@/lib/team/api";
import { checkPassword, decryptSecret, encryptSecret, hashPassword } from "@/lib/team/credentials";
import {
  access, leadView, myLeads, myMoves, repAddPromise, repCreateLead, repDeleteActivity, repLogActivity, repSetPromise, repUpdateLead,
} from "@/lib/team/leads";
import { checkNewLead } from "@/lib/team/new-lead";
import { makeRepToken, readRepToken } from "@/lib/team/rep-token";
import { dealShares, setDealShare, setItemVisibility } from "@/lib/team/sharing";
import {
  createTeamUser, currentRep, deleteTeamUser, revealTeamCredentials, setTeamActive, setTeamPassword, signIn, type Rep,
} from "@/lib/team/users";

const PW = "riya2026sales";
let riya: Rep;
let arjun: Rep;
let shared: number; // owner's deal, shared with Riya
let secret: number; // owner's deal, shared with nobody

/** Runs as the salesperson, the way /api/team does (authorship is stamped from this). */
const as = <T>(r: Rep, fn: () => Promise<T>) => repStore.run({ userId: r.id }, fn);
const rep = async (id: number): Promise<Rep> => (await one<Rep>("select id, username, display_name, member_id from sales_users where id = $1", [id]))!;

beforeAll(() => {
  process.env.AUTH_SECRET ??= "test-auth-secret-for-team-tokens-0123456789";
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 }))); // no research or AI calls leave the box
});

beforeEach(async () => {
  await q(`truncate sales_users, sales_deal_access restart identity cascade`);
  await q(`delete from sales_deals`);
  riya = await rep(await createTeamUser({ username: "riya.m", password: PW, display_name: "Riya" }));
  arjun = await rep(await createTeamUser({ username: "arjun", password: "arjun2026sales", display_name: "Arjun" }));
  shared = await createDeal({ title: "Shared Co", source: "inbound" });
  secret = await createDeal({ title: "Secret Co", source: "inbound" });
  await q("update sales_deals set value_amount = 500000, summary = 'owner private summary' where id in ($1,$2)", [shared, secret]);
  await setDealShare(shared, riya.id, { shared: true });
});

describe("credentials", () => {
  it("hashes for checking and encrypts for the owner to read back; neither is the password", async () => {
    const h = await hashPassword(PW);
    expect(h).not.toContain(PW);
    expect(await checkPassword(PW, h)).toBe(true);
    expect(await checkPassword(PW + "x", h)).toBe(false);
    const e = encryptSecret(PW);
    expect(e).toMatch(/^gcm1\$/);
    expect(e).not.toContain(PW);
    expect(decryptSecret(e)).toBe(PW);
    // a tampered copy does not open
    const parts = e.split("$");
    parts[3] = Buffer.from("x".repeat(20)).toString("base64");
    expect(decryptSecret(parts.join("$"))).toBeNull();
    const row = (await one<{ pass_hash: string; pass_enc: string }>("select pass_hash, pass_enc from sales_users where id = $1", [riya.id]))!;
    expect(JSON.stringify(row)).not.toContain(PW);
    expect(await revealTeamCredentials(riya.id)).toEqual({ username: "riya.m", password: PW });
  });

  it("refuses weak passwords, bad and taken usernames", async () => {
    await expect(createTeamUser({ username: "ab", password: PW, display_name: "X" })).rejects.toThrow();
    await expect(createTeamUser({ username: "new.one", password: "short1", display_name: "X" })).rejects.toThrow();
    await expect(createTeamUser({ username: "new.one", password: "onlyletterslong", display_name: "X" })).rejects.toThrow();
    await expect(createTeamUser({ username: "RIYA.M", password: PW, display_name: "X" })).rejects.toThrow(/taken/);
  });
});

describe("signing in", () => {
  it("gives the same answer for an unknown user and a wrong password, and locks after 5 misses", async () => {
    const a = await signIn("nobody", PW);
    const b = await signIn("riya.m", "wrongpass123");
    expect(a).toEqual(b);
    for (let i = 0; i < 4; i++) await signIn("riya.m", "wrongpass123");
    expect(await signIn("riya.m", PW)).toEqual({ error: expect.stringMatching(/Too many tries/) });
    await setTeamPassword(riya.id, "fresh2026pass"); // the owner resets: unlocked
    expect(await signIn("riya.m", "fresh2026pass")).toHaveProperty("token");
  });

  it("an encrypted token that cannot be read, forged or kept after a reset or switch-off", async () => {
    const r = (await signIn("riya.m", PW)) as { token: string };
    expect(r.token).not.toContain("riya");
    expect((await currentRep(r.token)).id).toBe(riya.id);
    // tampering with any character breaks it
    const c = r.token.at(-3)!;
    const t = r.token.slice(0, -3) + (c === "A" ? "B" : "A") + r.token.slice(-2); // always a different character
    await expect(currentRep(t)).rejects.toThrow();
    await expect(currentRep("garbage")).rejects.toThrow();
    await expect(currentRep(null)).rejects.toThrow();
    // expired
    const old = (await makeRepToken(riya.id, 0, Date.now() - 13 * 3600_000))!;
    expect(await readRepToken(old)).toBeNull();
    // the owner switches the login off: signed out at once, and cannot sign in
    await setTeamActive(riya.id, false);
    await expect(currentRep(r.token)).rejects.toThrow();
    expect(await signIn("riya.m", PW)).toEqual({ error: expect.stringMatching(/switched off/) });
    await setTeamActive(riya.id, true);
    await expect(currentRep(r.token)).rejects.toThrow(); // old session stays dead
    const r2 = (await signIn("riya.m", PW)) as { token: string };
    await setTeamPassword(riya.id, "another2026pw");
    await expect(currentRep(r2.token)).rejects.toThrow();
  });
});

describe("what a salesperson can see", () => {
  it("only leads shared with them or added by them; everything else is not found", async () => {
    expect((await myLeads(riya)).map((l) => l.id)).toEqual([shared]);
    expect(await myLeads(arjun)).toEqual([]);
    for (const id of [secret, 999999, -1, 0, Number.NaN]) {
      await expect(leadView(riya, id)).rejects.toBeInstanceOf(NotFound);
      await expect(repUpdateLead(riya, id, { next_action: "x" })).rejects.toBeInstanceOf(NotFound);
      await expect(repLogActivity(riya, id, { type: "call", body: "x" })).rejects.toBeInstanceOf(NotFound);
      await expect(repAddPromise(riya, id, { owner: "me", text: "x" })).rejects.toBeInstanceOf(NotFound);
    }
    await expect(leadView(arjun, shared)).rejects.toBeInstanceOf(NotFound);
    // unsharing takes it away
    await setDealShare(shared, riya.id, { shared: false });
    await expect(access(riya, shared)).rejects.toBeInstanceOf(NotFound);
  });

  it("hides the value, the owner's notes and the owner's updates unless shown", async () => {
    const ownerNote = await logActivity(shared, { type: "note", body: "owner thinks they will pay 9 lakh" });
    await addCommitment({ deal_id: shared, owner: "me", text: "owner private promise" });
    let v = await leadView(riya, shared);
    expect(v.deal.value_amount).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("owner private summary");
    expect(JSON.stringify(v)).not.toContain("9 lakh");
    expect(JSON.stringify(v)).not.toContain("owner private promise");
    expect(v.research).toBeNull();
    // the owner shows one update and the value
    await setItemVisibility("interaction", ownerNote, [riya.id]);
    await setDealShare(shared, riya.id, { shared: true, show_value: true, show_research: true });
    v = await leadView(riya, shared);
    expect(v.deal.value_amount).toBeTruthy();
    expect(JSON.stringify(v.timeline)).toContain("9 lakh");
    expect(v.research).not.toBeNull();
    // cannot be shown to someone without the lead
    await expect(setItemVisibility("interaction", ownerNote, [arjun.id])).rejects.toThrow(/Share the lead/);
  });

  it("their own updates are theirs; others' stay hidden until the owner passes one on", async () => {
    await setDealShare(shared, arjun.id, { shared: true });
    const mine = await as(riya, () => repLogActivity(riya, shared, { type: "call", body: "Called them, wants a demo" }));
    expect((await one<{ author_user: number }>("select author_user from sales_interactions where id = $1", [mine]))!.author_user).toBe(riya.id);
    expect(JSON.stringify((await leadView(riya, shared)).timeline)).toContain("wants a demo");
    expect(JSON.stringify((await leadView(arjun, shared)).timeline)).not.toContain("wants a demo");
    await expect(as(arjun, () => repDeleteActivity(arjun, mine))).rejects.toBeInstanceOf(NotFound);
    // the owner passes Riya's update to Arjun
    await setItemVisibility("interaction", mine, [arjun.id]);
    expect(JSON.stringify((await leadView(arjun, shared)).timeline)).toContain("wants a demo");
    // and they do not see each other on the lead
    expect(JSON.stringify(await leadView(arjun, shared))).not.toMatch(/Riya|riya\.m/);
    // their promises
    await as(riya, () => repAddPromise(riya, shared, { owner: "me", text: "send the deck" }));
    const p = (await one<{ id: number }>("select id from sales_commitments where text = 'send the deck'"))!.id;
    await expect(as(arjun, () => repSetPromise(arjun, p, "done"))).rejects.toBeInstanceOf(NotFound);
    await as(riya, () => repSetPromise(riya, p, "done"));
  });

  it("can change only the lead's working fields, never the value unless shown", async () => {
    for (const bad of [{ value_amount: 1 }, { summary: "hacked" }, { stage_id: 1 }, { created_by_user: riya.id }, { owner_id: 1 }])
      await expect(as(riya, () => repUpdateLead(riya, shared, { next_action: "x", ...bad }))).rejects.toThrow(/cannot change/);
    await as(riya, () => repUpdateLead(riya, shared, { next_action: "Call Monday" }));
    const d = (await one<{ next_action: string; value_amount: string; summary: string; created_by_user: number | null }>("select * from sales_deals where id = $1", [shared]))!;
    expect(d.next_action).toBe("Call Monday");
    expect(Number(d.value_amount)).toBe(500000);
    expect(d.summary).toBe("owner private summary");
    expect(d.created_by_user).toBeNull();
  });
});

describe("leads a salesperson adds", () => {
  const good = { company: "Shah Dental Clinics", person: "Ravi Shah", phone: "+91 98200 11111", source: "referral", referrer_name: "Meera", referrer_type: "team", need: "They miss calls and want a booking bot", status: "contacted" };

  it("checks the five required things but lets a genuine sparse lead in", () => {
    expect(checkNewLead({ source: "", status: "" }).ok).toBe(false);
    expect(checkNewLead({ ...good, phone: "123" }).errors.reach).toBeTruthy();
    expect(checkNewLead({ ...good, referrer_name: "" }).errors.source).toBeTruthy();
    expect(checkNewLead({ ...good, need: "bot" }).errors.need).toBeTruthy();
    expect(checkNewLead({ person: "Ravi Shah", email: "ravi@shahdental.in", source: "inbound", need: "wants a quote for a website", status: "new" }).ok).toBe(true);
    expect(checkNewLead(good).ok).toBe(true);
  });

  it("is theirs with value and research, refuses their own duplicate, and stays when the login is deleted", async () => {
    const id = await as(riya, () => repCreateLead(riya, good));
    const a = await access(riya, id);
    expect(a).toEqual({ show_value: true, show_research: true, mine: true });
    await expect(access(arjun, id)).rejects.toBeInstanceOf(NotFound);
    await expect(as(riya, () => repCreateLead(riya, good))).rejects.toThrow(/already have/);
    expect((await dealShares(id)).find((s) => s.user_id === riya.id)).toMatchObject({ added_it: true, shared: true });
    // the creator cannot be unshared
    await setDealShare(id, riya.id, { shared: false }).catch(() => {});
    expect((await access(riya, id)).mine).toBe(true);
    // it gets moves from what they can see
    expect(Array.isArray(await myMoves(riya))).toBe(true);
    await deleteTeamUser(riya.id);
    expect(await one("select 1 from sales_deals where id = $1", [id])).toBeTruthy();
  });

  it("flags a likely duplicate of the owner's lead without showing them the owner's data", async () => {
    const c = (await one<{ id: number }>("insert into sales_companies (name) values ('Shah Dental Clinics') returning id"))!.id;
    await q("update sales_deals set company_id = $1 where id = $2", [c, secret]);
    const id = await as(riya, () => repCreateLead(riya, good));
    const d = (await one<{ dup_hint: string | null; company_id: number }>("select dup_hint, company_id from sales_deals where id = $1", [id]))!;
    expect(d.dup_hint).toContain("Secret Co");
    expect(d.company_id).not.toBe(c); // a separate record
    expect(JSON.stringify(await leadView(riya, id))).not.toContain("Secret Co");
  });
});
