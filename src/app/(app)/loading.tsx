export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded-xl bg-muted" />
      <div className="h-4 w-72 rounded-lg bg-muted" />
      <div className="mt-6 space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 w-full rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
