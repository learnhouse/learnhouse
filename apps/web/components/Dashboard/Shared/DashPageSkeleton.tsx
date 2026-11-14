// Placeholder for a dashboard page whose code or route payload is still on
// its way (loading.tsx). It mirrors the shared page shape (DashPageHeader,
// a row of StatCards, one list card) so the real page replaces it without a
// jump. Server-safe: no hooks, no client code.
export default function DashPageSkeleton({ stats = 4, rows = 6 }: { stats?: number; rows?: number }) {
  return (
    <div className="px-4 sm:px-10 pb-16 flex flex-col gap-5 w-full min-w-0 animate-pulse" aria-busy="true">
      <div className="flex flex-col gap-4 pt-4 sm:pt-6">
        <div className="h-3.5 w-28 rounded bg-neutral-200" />
        <div className="space-y-2">
          <div className="h-7 sm:h-8 w-48 rounded-lg bg-neutral-200" />
          <div className="h-3.5 w-72 max-w-full rounded bg-neutral-100" />
        </div>
      </div>
      {stats > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 bg-white nice-shadow rounded-2xl px-4 py-3.5">
              <div className="w-9 h-9 rounded-xl bg-neutral-100 shrink-0" />
              <div className="space-y-1.5 min-w-0">
                <div className="h-3 w-16 rounded bg-neutral-100" />
                <div className="h-5 w-8 rounded bg-neutral-200" />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="h-9 w-full sm:w-72 rounded-lg bg-white nice-shadow" />
      </div>
      <div className="bg-white nice-shadow rounded-2xl divide-y divide-neutral-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <div className="w-16 h-10 rounded-lg bg-neutral-100 shrink-0" />
            <div className="flex-1 space-y-2 min-w-0">
              <div className="h-3.5 w-1/3 rounded bg-neutral-200" />
              <div className="h-3 w-1/2 rounded bg-neutral-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
