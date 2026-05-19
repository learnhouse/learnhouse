'use client'

// ---------------------------------------------------------------------------
// CourseCardSkeleton
// Mirrors CourseThumbnail layout:
//   - aspect-video thumbnail area
//   - p-3 body: title line, description lines, bottom bar (avatars + date + CTA)
// ---------------------------------------------------------------------------
export function CourseCardSkeleton() {
  return (
    <div className="flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full">
      {/* Thumbnail – aspect-video */}
      <div className="relative aspect-video bg-gray-200 dark:bg-gray-700 animate-pulse" />

      {/* Card body */}
      <div className="p-3 flex flex-col space-y-2">
        {/* Title */}
        <div className="h-4 w-3/4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />

        {/* Description – 2 lines */}
        <div className="space-y-1">
          <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-3 w-5/6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>

        {/* Bottom bar */}
        <div className="pt-1.5 flex items-center justify-between border-t border-gray-100">
          {/* Avatar stack + date */}
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse border-2 border-white" />
              <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse border-2 border-white" />
            </div>
            <div className="h-2.5 w-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          </div>
          {/* CTA */}
          <div className="h-2.5 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CourseGridSkeleton
// Grid of CourseCardSkeleton items matching the standard course grid layout.
// ---------------------------------------------------------------------------
export function CourseGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <CourseCardSkeleton key={i} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CourseDetailSkeleton
// Hero banner + chapter/activity list.
// ---------------------------------------------------------------------------
export function CourseDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto px-4 py-8">
      {/* Hero */}
      <div className="rounded-xl overflow-hidden bg-gray-200 dark:bg-gray-700 animate-pulse aspect-video w-full" />

      {/* Title + description */}
      <div className="space-y-3">
        <div className="h-7 w-2/3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-4 w-5/6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </div>

      {/* Chapter list */}
      <div className="space-y-3 mt-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 p-4 rounded-xl border border-gray-100 bg-white">
            {/* Chapter heading */}
            <div className="h-4 w-1/3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            {/* Activities */}
            <div className="space-y-2 pl-4">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse flex-shrink-0" />
                  <div className="h-3 flex-1 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActivitySkeleton
// Placeholder for the activity/editor area: toolbar + editor body.
// ---------------------------------------------------------------------------
export function ActivitySkeleton() {
  return (
    <div className="flex flex-col w-full h-full min-h-screen gap-4 p-6">
      {/* Toolbar row */}
      <div className="flex items-center gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
        ))}
      </div>

      {/* Editor body */}
      <div className="flex-1 rounded-xl bg-white border border-gray-100 p-6 space-y-4">
        <div className="h-6 w-1/2 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" style={{ width: `${85 - i * 5}%` }} />
        ))}
        <div className="h-40 w-full bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse mt-4" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" style={{ width: `${75 + i * 5}%` }} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommunityListSkeleton
// List of community card rows.
// ---------------------------------------------------------------------------
export function CommunityListSkeleton() {
  return (
    <div className="flex flex-col gap-3 w-full">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-white border border-gray-100">
          {/* Icon / avatar */}
          <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-gray-700 animate-pulse flex-shrink-0" />
          {/* Text block */}
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="h-4 w-1/3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-3 w-2/3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          </div>
          {/* CTA pill */}
          <div className="h-7 w-16 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse flex-shrink-0" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DashboardSkeleton
// Generic dashboard layout: stat cards + a chart area.
// ---------------------------------------------------------------------------
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6 w-full">
      {/* Stat cards row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-white border border-gray-100 p-4 flex flex-col gap-3">
            <div className="h-3 w-1/2 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-7 w-2/3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Chart / table placeholder */}
      <div className="rounded-xl bg-white border border-gray-100 p-6 flex flex-col gap-4">
        <div className="h-4 w-1/4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-48 w-full bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
      </div>

      {/* List section */}
      <div className="rounded-xl bg-white border border-gray-100 p-6 flex flex-col gap-3">
        <div className="h-4 w-1/4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse flex-shrink-0" />
            <div className="h-3 flex-1 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-3 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PageSkeleton
// Full-page generic skeleton: nav bar + content area.
// ---------------------------------------------------------------------------
export function PageSkeleton() {
  return (
    <div className="flex flex-col min-h-screen w-full">
      {/* Nav bar */}
      <div className="h-14 border-b border-gray-100 bg-white flex items-center px-6 gap-4">
        <div className="w-24 h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="flex-1" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="w-16 h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        ))}
        <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
      </div>

      {/* Page body */}
      <div className="flex-1 p-8 flex flex-col gap-6 max-w-5xl mx-auto w-full">
        {/* Page title */}
        <div className="h-8 w-1/3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />

        {/* Content blocks */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-white border border-gray-100 p-6 space-y-3">
            <div className="h-5 w-1/4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-4 w-5/6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-4 w-4/6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
