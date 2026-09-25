import { Skeleton } from "@/components/ui";

/** Shown instantly while any page's data loads. Specific pages have their own, closer to their layout. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-5" aria-busy aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
