import { ago } from "./format";

/**
 * "5m ago", safe to render on the server: the browser may draw it a few seconds later and get "6m ago", which is
 * correct, so React is told not to treat the difference as an error.
 */
export function Ago({ d }: { d: string | Date | null | undefined }) {
  return <span suppressHydrationWarning>{ago(d)}</span>;
}
