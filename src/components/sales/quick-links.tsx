"use client";

import { AtSign, Copy, ExternalLink, Globe, Linkedin, Mail, MapPin, MessageCircle, Phone, User } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { SOURCE_LABEL, type LinkGroup, type LinkKind, type QuickLink } from "@/lib/sales/quick-links-types";

const ICON: Record<LinkKind, typeof Mail> = {
  post: ExternalLink, profile: User, whatsapp: MessageCircle, call: Phone, email: Mail, linkedin: Linkedin, social: AtSign, website: Globe, map: MapPin,
};

function Chip({ l }: { l: QuickLink }) {
  const { toast } = useToast();
  const I = ICON[l.kind] ?? ExternalLink;
  const external = /^https?:/i.test(l.href);
  const guess = l.source === "guess";
  return (
    <span className={cn("inline-flex max-w-full items-stretch overflow-hidden rounded-xl border text-xs", guess ? "border-warn/40 bg-warn-muted" : "border-border bg-surface")}>
      <a
        href={l.href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className="flex min-w-0 items-center gap-1.5 px-2.5 py-1.5 hover:bg-muted"
        title={`${l.label}${l.value ? `: ${l.value}` : ""} (${SOURCE_LABEL[l.source]})`}
      >
        <I className={cn("h-3.5 w-3.5 shrink-0", guess ? "text-warn" : "text-accent")} />
        <span className="font-medium">{l.label}</span>
        {l.value ? <span className="truncate text-subtle">{l.value}</span> : null}
        <span className={cn("shrink-0 text-[10px]", guess ? "font-semibold text-warn" : "text-subtle/80")}>· {SOURCE_LABEL[l.source]}</span>
      </a>
      {l.copy ? (
        <button
          type="button"
          aria-label={`Copy ${l.copy}`}
          title="Copy"
          className="border-l border-border px-2 text-subtle hover:bg-muted hover:text-fg"
          onClick={() =>
            void navigator.clipboard.writeText(l.copy!).then(
              () => toast("Copied"),
              () => toast("Your browser blocked copying. Select it and copy by hand.", "error"),
            )
          }
        >
          <Copy className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}

/** Everything to reach a lead, as one-tap links. `fold` shows the first groups and a "show all" toggle. */
export function QuickLinks({ groups, fold = 0, title = "Quick links" }: { groups: LinkGroup[]; fold?: number; title?: string }) {
  const [all, setAll] = useState(false);
  if (!groups.length) return null;
  const total = groups.reduce((n, g) => n + g.links.length, 0);
  const shown = fold && !all ? groups.slice(0, fold) : groups;
  const hidden = groups.length - shown.length;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{title} · {total}</p>
      {shown.map((g) => (
        <div key={g.title}>
          <p className="mb-1 text-xs font-semibold">{g.title}</p>
          {g.note ? <p className="mb-1 text-xs text-subtle">{g.note}</p> : null}
          {g.links.length ? <div className="flex flex-wrap gap-1.5">{g.links.map((l) => <Chip key={l.href + l.label} l={l} />)}</div> : null}
        </div>
      ))}
      {hidden > 0 ? (
        <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setAll(true)}>
          Show all ({hidden} more: company, people)
        </button>
      ) : null}
    </div>
  );
}
