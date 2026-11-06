import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifyToken } from "../session-token";

/** A stable, anonymous id for a visitor (IP + browser), never the raw IP. */
export function visitorId(h: Headers): string {
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "?";
  return createHash("sha256").update(`${ip}|${h.get("user-agent") ?? ""}`).digest("hex").slice(0, 16);
}

/** Your own opens (logged in to Daybook) never count as client views. */
export async function isOwnerRequest(): Promise<boolean> {
  const c = await cookies();
  return verifyToken("session", c.get(SESSION_COOKIE)?.value);
}
