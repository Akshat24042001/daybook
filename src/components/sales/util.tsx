"use client";

import {
  CalendarDays, FileText, Handshake, Instagram, Linkedin, Mail, MessageCircle, Phone, StickyNote, Twitter, MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export { ago, CURRENCIES, currencyLabel, currencySymbol, fmtDate, money } from "./format";

const ICONS: Record<string, typeof Mail> = {
  whatsapp: MessageCircle, email: Mail, linkedin: Linkedin, call: Phone, meeting: CalendarDays, in_person: Handshake,
  instagram: Instagram, twitter: Twitter, document: FileText, note: StickyNote, sms: MessageSquare, telegram: MessageSquare, other: MessageSquare,
};

export function ChannelIcon({ channel, className }: { channel: string | null | undefined; className?: string }) {
  const I = ICONS[channel ?? "other"] ?? MessageSquare;
  return <I className={cn("h-4 w-4", className)} aria-label={channel ?? "other"} />;
}

export const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp", email: "Email", linkedin: "LinkedIn", call: "Call", meeting: "Meeting", in_person: "In person", instagram: "Instagram",
  twitter: "X", document: "Document", note: "Note", sms: "SMS", telegram: "Telegram", other: "Other",
};

const TABS = [
  { href: "/sales", label: "Moves", inSidebar: true },
  { href: "/sales/pipeline", label: "Pipeline", inSidebar: true },
  { href: "/sales/radar", label: "Radar", inSidebar: true },
  { href: "/sales/accounts", label: "Accounts", inSidebar: true },
  { href: "/sales/insights", label: "Insights", inSidebar: true },
  { href: "/sales/playbook", label: "Playbook", inSidebar: true },
  { href: "/sales/docs", label: "Documents", inSidebar: false },
  { href: "/sales/review", label: "Review", inSidebar: false },
  { href: "/sales/settings", label: "Settings", inSidebar: false },
];

export function SalesTabs() {
  const path = usePathname();
  return (
    <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-border px-4 md:mx-0 md:justify-end md:border-0 md:px-0" aria-label="Sales">
      {TABS.map((t) => {
        const active = t.href === "/sales" ? path === "/sales" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              // the desktop sidebar already lists the first four; the rest stay here
              t.inSidebar && "md:hidden",
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors md:mb-0 md:rounded-md md:border-0 md:py-1.5",
              active ? "border-accent text-fg md:bg-muted" : "border-transparent text-subtle hover:text-fg md:hover:bg-muted",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Priority 0-100 with its tier, the trend since yesterday, and the reasons on hover. */
/**
 * Priority bands, greener as it rises: what to work on first. The number is 0 to 100 (see lib/sales/priority.ts);
 * the arrow is the change since yesterday (5 points or more).
 */
export const PRIORITY_BANDS = [
  { min: 70, label: "Hot", range: "70-100", tone: "bg-good text-good-on", meaning: "act today" },
  { min: 45, label: "Warm", range: "45-69", tone: "bg-p-mint text-p-mint-fg", meaning: "this week" },
  { min: 20, label: "Steady", range: "20-44", tone: "bg-p-butter text-p-butter-fg", meaning: "keep warm" },
  { min: 0, label: "Cold", range: "0-19", tone: "bg-muted text-subtle", meaning: "quiet for now" },
] as const;
export const priorityBand = (v: number) => PRIORITY_BANDS.find((b) => v >= b.min) ?? PRIORITY_BANDS[3];

export function Priority({ value, prev, why, compact }: { value: number; prev?: number | null; why?: string[] | null; compact?: boolean }) {
  const b = priorityBand(value);
  const delta = prev === null || prev === undefined ? 0 : value - prev;
  const arrow = delta >= 5 ? "↑" : delta <= -5 ? "↓" : "";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tabular", b.tone)}
      title={`Priority ${value}/100: ${b.label} (${b.meaning})${delta ? `. ${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} since yesterday` : ""}${why?.length ? `\n${why.join("\n")}` : ""}`}
    >
      {compact ? null : b.label} {value}
      {arrow ? <span className={b.min === 70 ? undefined : delta > 0 ? "text-good" : "text-bad"} aria-label={delta > 0 ? "rising" : "falling"}>{arrow}</span> : null}
    </span>
  );
}

/** One line that explains the colours and the arrow. */
export function PriorityLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
      <span>Priority 0 to 100:</span>
      {PRIORITY_BANDS.map((b) => (
        <span key={b.label} className="inline-flex items-center gap-1">
          <span className={cn("rounded px-1.5 py-px font-semibold", b.tone)}>{b.label}</span>
          {b.range}
        </span>
      ))}
      <span>· ↑ or ↓ moved 5+ points since yesterday</span>
    </p>
  );
}

/** Kept for older call sites. */
export function Heat({ value }: { value: number }) {
  return <Priority value={value} compact />;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent">{children}</p>;
}
