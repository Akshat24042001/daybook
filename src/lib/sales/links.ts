/**
 * One-tap actions. A "go" link logs the touch, closes the move, then opens WhatsApp / mail / LinkedIn / the dialer with
 * the draft ready. That is how sending something logs it without you typing anything into Daybook.
 * Links are signed so they work from Telegram without a login and cannot be forged.
 */
import { noDashes } from "../text/no-dashes";
import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "../clock";
import { waDigits } from "./identity";

function secret(): string {
  const s = process.env.AUTH_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (s) return s;
  // never sign with a guessable key in production: anyone could forge "go" links and view beacons
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET (or CRON_SECRET) must be set to sign sales links.");
  return `daybook-sales:${process.env.ADMIN_PASSWORD ?? "dev"}`;
}

export function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url").slice(0, 22);
}

export function verify(value: string, sig: string | null | undefined): boolean {
  return safeEqual(sign(value), sig ?? "");
}

export function baseUrl(): string {
  const explicit = process.env.APP_BASE_URL?.trim();
  if (explicit && explicit !== "http://localhost:3000") {
    try {
      return new URL(explicit).origin;
    } catch {
      return explicit.replace(/\/+$/, "");
    }
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return explicit || "http://localhost:3000";
}

export function newSlug(len = 10): string {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(len);
  let s = "";
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}

export type GoChannel = "whatsapp" | "email" | "linkedin" | "instagram" | "call" | "sms";

/** Where a channel opens, with the text ready when the app supports it. */
export function channelUrl(channel: GoChannel, to: { phone?: string | null; email?: string | null; linkedin?: string | null; instagram?: string | null }, text = "", subject = ""): string | null {
  // the last stop before a message leaves: never with a long dash, whoever wrote it
  text = noDashes(text);
  subject = noDashes(subject);
  switch (channel) {
    case "whatsapp": {
      const d = waDigits(to.phone);
      return d ? `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}` : text ? `https://wa.me/?text=${encodeURIComponent(text)}` : null;
    }
    case "email":
      return to.email ? `mailto:${encodeURIComponent(to.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : null;
    case "linkedin":
      return to.linkedin ? (/^https?:/i.test(to.linkedin) ? to.linkedin : `https://www.linkedin.com/in/${to.linkedin.replace(/^in\//, "")}`) : null;
    case "instagram":
      return to.instagram ? `https://ig.me/m/${to.instagram.replace(/^@/, "")}` : null;
    case "call":
      return to.phone ? `tel:${to.phone.replace(/[^\d+]/g, "")}` : null;
    case "sms":
      return to.phone ? `sms:${to.phone.replace(/[^\d+]/g, "")}${text ? `&body=${encodeURIComponent(text)}` : ""}` : null;
  }
}

/** A signed link that opens a move's destination (see reply-targets) and remembers it was opened. Never logs a send. */
export function goLink(moveId: number, targetId: string): string {
  const v = `${moveId}.${targetId}`;
  return `${baseUrl()}/api/sales/go?m=${moveId}&c=${targetId}&s=${sign(v)}`;
}
