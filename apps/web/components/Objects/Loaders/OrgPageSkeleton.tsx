// In-pane placeholder for org-site pages (loading.tsx). The header and menu
// stay on screen and only the page body pulses; it replaces a full-screen
// spinner that covered everything, menu included, on every navigation that
// wasn't prefetched. Server-safe: no hooks, no client code.

type Variant = 'grid' | 'course' | 'activity' | 'list'

const WRAP = 'max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8 py-5 w-full animate-pulse'

function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-neutral-200/80 ${className}`} />
}

export default function OrgPageSkeleton({ variant = 'grid' }: { variant?: Variant }) {
  if (variant === 'activity') {
    return (
      <div className={WRAP} aria-busy="true">
        <div className="space-y-3 pt-2">
          <Bar className="h-3.5 w-48" />
          <Bar className="h-7 w-2/3 max-w-xl" />
        </div>
        <div className="mt-6 bg-white rounded-2xl nice-shadow p-6 sm:p-8 space-y-4">
          <Bar className="h-4 w-1/2" />
          <Bar className="h-3.5 w-full" />
          <Bar className="h-3.5 w-11/12" />
          <Bar className="h-3.5 w-4/5" />
          <div className="h-48 sm:h-64 rounded-xl bg-neutral-100" />
          <Bar className="h-3.5 w-full" />
          <Bar className="h-3.5 w-3/4" />
        </div>
      </div>
    )
  }

  if (variant === 'course') {
    return (
      <div className={WRAP} aria-busy="true">
        <div className="space-y-3 pt-2">
          <Bar className="h-3.5 w-40" />
          <Bar className="h-8 w-1/2 max-w-lg" />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="aspect-video rounded-2xl bg-neutral-100" />
            <div className="bg-white rounded-2xl nice-shadow divide-y divide-neutral-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-8 h-8 rounded-lg bg-neutral-100 shrink-0" />
                  <Bar className="h-3.5 w-1/2" />
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-2xl nice-shadow p-5 space-y-3 h-fit">
            <Bar className="h-4 w-2/3" />
            <Bar className="h-3 w-full" />
            <div className="h-9 rounded-lg bg-neutral-100" />
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'list') {
    return (
      <div className={WRAP} aria-busy="true">
        <div className="space-y-3 pt-2">
          <Bar className="h-7 w-48" />
          <Bar className="h-3.5 w-72 max-w-full" />
        </div>
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl nice-shadow p-4 space-y-2">
              <Bar className="h-3 w-16" />
              <Bar className="h-5 w-10" />
            </div>
          ))}
        </div>
        <div className="mt-6 bg-white rounded-2xl nice-shadow divide-y divide-neutral-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <div className="w-16 h-10 rounded-lg bg-neutral-100 shrink-0" />
              <div className="flex-1 space-y-2">
                <Bar className="h-3.5 w-1/3" />
                <div className="h-1.5 w-1/2 rounded-full bg-neutral-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={WRAP} aria-busy="true">
      <div className="space-y-3 pt-2">
        <Bar className="h-7 w-44" />
        <Bar className="h-3.5 w-72 max-w-full" />
      </div>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl nice-shadow overflow-hidden">
            <div className="aspect-video bg-neutral-100" />
            <div className="p-3 space-y-2">
              <Bar className="h-4 w-3/4" />
              <Bar className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
