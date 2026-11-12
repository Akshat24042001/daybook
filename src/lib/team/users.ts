/**
 * Sales team logins: created and controlled by the owner only. A salesperson can sign in and out; there is no way for
 * them to change a username or password. Disabling a login, or setting a new password, ends their open sessions.
 */
import { cookies } from "next/headers";
import { one, q, UserError } from "../db";
import { checkNewPassword, checkPassword, checkUsername, decryptSecret, encryptSecret, hashPassword } from "./credentials";
import { REP_COOKIE, makeRepToken, readRepToken } from "./rep-token";

export interface TeamUser {
  id: number;
  username: string;
  display_name: string;
  member_id: number | null;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
  leads: number;
}

export interface Rep {
  id: number;
  username: string;
  display_name: string;
  member_id: number | null;
}

const MAX_FAILS = 5;
const LOCK_MIN = 15;

// ---------------------------------------------------------------- owner: manage logins

export async function listTeamUsers(): Promise<TeamUser[]> {
  return q<TeamUser>(
    `select u.id, u.username, u.display_name, u.member_id, u.active, u.last_login_at, u.created_at,
       (select count(*)::int from sales_deal_access a where a.user_id = u.id) as leads
     from sales_users u order by u.active desc, lower(u.display_name)`,
  );
}

export async function createTeamUser(o: { username: string; password: string; display_name: string; member_id?: number | null }): Promise<number> {
  const username = o.username.trim();
  const name = o.display_name.trim();
  const bad = checkUsername(username) ?? checkNewPassword(o.password);
  if (bad) throw new UserError(bad);
  if (!name) throw new UserError("Give the salesperson a name.");
  if (await one("select 1 from sales_users where lower(username) = lower($1)", [username])) throw new UserError("That username is taken. Pick another.");
  // a salesperson is also a team member, so their leads can carry them as the owner
  const memberId = o.member_id ?? (await one<{ id: number }>("insert into sales_team (name, role) values ($1, 'Sales') returning id", [name]))!.id;
  const row = await one<{ id: number }>(
    "insert into sales_users (username, display_name, member_id, pass_hash, pass_enc) values ($1,$2,$3,$4,$5) returning id",
    [username, name, memberId, await hashPassword(o.password), encryptSecret(o.password)],
  );
  return row!.id;
}

export async function setTeamPassword(id: number, password: string): Promise<void> {
  const bad = checkNewPassword(password);
  if (bad) throw new UserError(bad);
  const r = await q("update sales_users set pass_hash = $2, pass_enc = $3, session_version = session_version + 1, failed_logins = 0, locked_until = null where id = $1 returning id",
    [id, await hashPassword(password), encryptSecret(password)]);
  if (!r.length) throw new UserError("That login no longer exists.");
}

export async function setTeamUsername(id: number, username: string): Promise<void> {
  const bad = checkUsername(username);
  if (bad) throw new UserError(bad);
  if (await one("select 1 from sales_users where lower(username) = lower($1) and id <> $2", [username.trim(), id])) throw new UserError("That username is taken.");
  await q("update sales_users set username = $2, session_version = session_version + 1 where id = $1", [id, username.trim()]);
}

export async function setTeamActive(id: number, active: boolean): Promise<void> {
  await q("update sales_users set active = $2, session_version = session_version + 1, failed_logins = 0, locked_until = null where id = $1", [id, active]);
}

export async function deleteTeamUser(id: number): Promise<void> {
  // their leads stay (with you); only the login and its shares go
  await q("delete from sales_users where id = $1", [id]);
}

/** The owner reads back what they set. Null when the stored copy cannot be opened (the server secret changed). */
export async function revealTeamCredentials(id: number): Promise<{ username: string; password: string | null }> {
  const u = await one<{ username: string; pass_enc: string }>("select username, pass_enc from sales_users where id = $1", [id]);
  if (!u) throw new UserError("That login no longer exists.");
  return { username: u.username, password: decryptSecret(u.pass_enc) };
}

// ---------------------------------------------------------------- salesperson: sign in, who am I

/** Checks a sign-in. Same answer for an unknown user and a wrong password; locks for 15 minutes after 5 misses. */
export async function signIn(username: string, password: string): Promise<{ token: string } | { error: string }> {
  const generic = { error: "That username and password do not match." };
  if (!username || !password || username.length > 60 || password.length > 200) return generic;
  const u = await one<{ id: number; pass_hash: string; active: boolean; session_version: number; failed_logins: number; locked_until: string | null }>(
    "select id, pass_hash, active, session_version, failed_logins, locked_until from sales_users where lower(username) = lower($1)",
    [username.trim()],
  );
  if (!u) {
    // spend the same time as a real check, so timing does not tell which usernames exist
    await checkPassword(password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    return generic;
  }
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) return { error: "Too many tries. Wait 15 minutes, or ask for your password to be reset." };
  const ok = await checkPassword(password, u.pass_hash);
  if (!ok) {
    await q(
      `update sales_users set failed_logins = failed_logins + 1,
         locked_until = case when failed_logins + 1 >= $2 then now() + ($3 || ' minutes')::interval else locked_until end where id = $1`,
      [u.id, MAX_FAILS, String(LOCK_MIN)],
    );
    return generic;
  }
  if (!u.active) return { error: "This login is switched off. Ask the owner." };
  await q("update sales_users set failed_logins = 0, locked_until = null, last_login_at = now() where id = $1", [u.id]);
  const token = await makeRepToken(u.id, u.session_version);
  if (!token) return { error: "Sign-in is not set up on the server." };
  return { token };
}

export class NotSignedIn extends Error {}

/** The signed-in salesperson, checked against the database on every request (active, same session version). */
export async function currentRep(token?: string | null): Promise<Rep> {
  const t = token !== undefined ? token : (await cookies()).get(REP_COOKIE)?.value;
  const c = await readRepToken(t);
  if (!c) throw new NotSignedIn("not signed in");
  const u = await one<Rep & { active: boolean; session_version: number }>(
    "select id, username, display_name, member_id, active, session_version from sales_users where id = $1",
    [c.u],
  );
  if (!u || !u.active || u.session_version !== c.v) throw new NotSignedIn("session ended");
  return { id: u.id, username: u.username, display_name: u.display_name, member_id: u.member_id };
}
