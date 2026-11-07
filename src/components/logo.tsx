import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * The Daybook mark: a "D" with a rising sun cut into its bowl (the start of a day), on a blue tile.
 * The sunrise is a true cut-out (an SVG mask), so the tile shows through it on any background.
 * Same geometry as public/logo.svg and the PWA icons (scripts/make-icons.mjs).
 */
export function LogoMark({ size = 28, className, title }: { size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
        <mask id={`${id}m`}>
          <path d="M18 13h13.5a19 19 0 0 1 0 38H18z" fill="#fff" />
          <path d="M25 39.6a7.2 7.2 0 0 1 14.4 0z" fill="#000" />
          <rect x="22" y="41.2" width="20.5" height="2.6" rx="1.3" fill="#000" />
          <path d="M32.2 26.2v2.6M24.4 29.6l1.8 1.8M40 29.6l-1.8 1.8" stroke="#000" strokeWidth="2.4" strokeLinecap="round" />
        </mask>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${id}g)`} />
      <rect width="64" height="64" fill="#fff" mask={`url(#${id}m)`} />
    </svg>
  );
}

/** Mark plus the name, as used in the sidebar, the phone header and the sign-in page. */
export function Logo({ size = 28, className, textClassName }: { size?: number; className?: string; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <span className={cn("font-display text-[15px] font-semibold tracking-[-0.02em] text-fg", textClassName)}>Daybook</span>
    </span>
  );
}
