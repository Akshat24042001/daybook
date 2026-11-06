"use client";

import {
  CalendarDays, FileText, Handshake, Instagram, Linkedin, Mail, MessageCircle, Phone, StickyNote, Twitter, MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export { ago, fmtDate, money } from "./format";

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
  { href: "/sales", label: "Moves" },
  { href: "/sales/pipeline", label: "Pipeline" },
  { href: "/sales/radar", label: "Radar" },
  { href: "/sales/accounts", label: "Accounts" },
  { href: "/sales/docs", label: "Documents" },
  { href: "/sales/review", label: "Review" },
  { href: "/sales/settings", label: "Settings" },
];

export function SalesTabs() {
  const path = usePathname();
  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0" aria-label="Sales">
      {TABS.map((t) => {
        const active = t.href === "/sales" ? path === "/sales" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle hover:border-accent/40 hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Heat({ value }: { value: number }) {
  const tone = value >= 70 ? "bg-bad" : value >= 45 ? "bg-warn" : value >= 20 ? "bg-accent" : "bg-subtle/40";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] tabular text-subtle" title={`Heat ${value}/100: how alive this deal is`}>
      <span className={cn("h-2 w-2 rounded-full", tone)} />
      {value}
    </span>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">{children}</p>;
}
