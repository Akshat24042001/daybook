/** Tailwind classes for a 0-10 day rating chip: green when good, amber when middling, red when poor. */
export function ratingTone(r: number | null): string {
  if (r === null) return "bg-muted text-subtle";
  if (r >= 7) return "bg-good-muted text-good";
  if (r >= 4.5) return "bg-warn-muted text-warn";
  return "bg-bad-muted text-bad";
}
