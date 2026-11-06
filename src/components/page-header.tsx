import { cn } from "@/lib/cn";
import { HUE, type Hue } from "@/lib/hue";

/**
 * The one page header. Every page opens the same way: an icon in its own colour, a title, one line saying what the page
 * is for, and the page's main actions on the right. Same size, same spacing, same left edge, everywhere.
 */
export function PageHeader({
  icon: Icon, hue, title, subtitle, actions, className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  hue: Hue;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const h = HUE[hue];
  return (
    <header className={cn("mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-[var(--shadow-sm)]", h.fill, "text-fg/80")} aria-hidden>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-tight sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-subtle">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
