function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-gray-200 dark:bg-gray-700 rounded animate-pulse ${className}`}
    />
  )
}

export default function Loading() {
  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      <div className="pl-4 pr-4 sm:pl-10 sm:pr-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0 relative">
        <div className="pt-6 pb-4">
          <SkeletonBlock className="h-4 w-32" />
        </div>
        <div className="my-2 py-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-col space-y-3">
              <SkeletonBlock className="h-10 w-48" />
              <SkeletonBlock className="h-5 w-72 max-w-full" />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <SkeletonBlock key={i} className="h-8 w-11 rounded-md" />
                ))}
              </div>
              <SkeletonBlock className="h-8 w-24 rounded-md" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-2 border-b-2 border-transparent px-3 py-3"
            >
              <SkeletonBlock className="h-4 w-4 rounded" />
              <SkeletonBlock className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>

      <div className="h-6 flex-shrink-0" />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-10 pb-10">
        <div className="space-y-6 max-w-[1600px] mx-auto w-full">
          <div className="bg-white nice-shadow rounded-xl overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 lg:divide-x divide-gray-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <SkeletonBlock className="h-4 w-4 rounded" />
                    <SkeletonBlock className="h-3 w-24" />
                  </div>
                  <SkeletonBlock className="h-7 w-16 mb-2" />
                  <SkeletonBlock className="h-3 w-20" />
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100 px-5 pt-4 pb-5">
              <SkeletonBlock className="h-4 w-40 mb-4" />
              <SkeletonBlock className="h-[240px] w-full rounded-xl" />
            </div>

            <div className="border-t border-gray-100 grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
              {Array.from({ length: 3 }).map((_, sectionIndex) => (
                <div key={sectionIndex} className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <SkeletonBlock className="h-4 w-4 rounded" />
                    <SkeletonBlock className="h-4 w-28" />
                  </div>
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, rowIndex) => (
                      <div key={rowIndex} className="flex items-center gap-2">
                        <SkeletonBlock className="h-5 flex-1" />
                        <SkeletonBlock className="h-3 w-10" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white nice-shadow rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
            <div className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <SkeletonBlock className="h-4 w-4 rounded" />
                <SkeletonBlock className="h-4 w-36" />
              </div>
              <div className="space-y-3 h-[220px] flex flex-col justify-center">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <SkeletonBlock className="h-3 w-20" />
                    <SkeletonBlock className="h-6 flex-1" />
                  </div>
                ))}
              </div>
            </div>

            {Array.from({ length: 2 }).map((_, sectionIndex) => (
              <div key={sectionIndex} className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <SkeletonBlock className="h-4 w-4 rounded" />
                  <SkeletonBlock className="h-4 w-32" />
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, rowIndex) => (
                    <div key={rowIndex} className="flex items-center gap-3 p-2">
                      <SkeletonBlock className="h-10 w-10 rounded-lg flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <SkeletonBlock className="h-4 w-4/5" />
                        <div className="flex gap-3">
                          <SkeletonBlock className="h-3 w-12" />
                          <SkeletonBlock className="h-3 w-12" />
                          <SkeletonBlock className="h-3 w-12" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
