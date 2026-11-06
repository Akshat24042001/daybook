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
  { href: "/sales", label: "Moves", inSidebar: true },
  { href: "/sales/pipeline", label: "Pipeline", inSidebar: true },
  { href: "/sales/radar", label: "Radar", inSidebar: true },
  { href: "/sales/accounts", label: "Accounts", inSidebar: true },
  { href: "/sales/docs", label: "Documents", inSidebar: false },
  { href: "/sales/review", label: "Review", inSidebar: false },
  { href: "/sales/settings", label: "Settings", inSidebar: false },
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
              // the desktop sidebar already lists the first four; the rest stay here
              t.inSidebar && "md:hidden",
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

/** Priority 0-100 with its tier, the trend since yesterday, and the reasons on hover. */
export function Priority({ value, prev, why, compact }: { value: number; prev?: number | null; why?: string[] | null; compact?: boolean }) {
  const t = value >= 70 ? ["Hot", "bg-p-rose text-p-rose-fg"] : value >= 45 ? ["Warm", "bg-p-butter text-p-butter-fg"] : value >= 20 ? ["Steady", "bg-p-sky text-p-sky-fg"] : ["Cold", "bg-muted text-subtle"];
  const delta = prev === null || prev === undefined ? 0 : value - prev;
  const arrow = delta >= 5 ? "↑" : delta <= -5 ? "↓" : "";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular", t[1])}
      title={`Priority ${value}/100${delta ? ` (${delta > 0 ? "+" : ""}${delta} since yesterday)` : ""}${why?.length ? `\n${why.join("\n")}` : ""}`}
    >
      {compact ? null : t[0]} {value}
      {arrow ? <span className={delta > 0 ? "text-good" : "text-bad"}>{arrow}</span> : null}
    </span>
  );
}

/** Kept for older call sites. */
export function Heat({ value }: { value: number }) {
  return <Priority value={value} compact />;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent">{children}</p>;
}
