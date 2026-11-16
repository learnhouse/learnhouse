// Kept apart from BuilderLanding so pages can show it while the renderer's
// chunk downloads. At least a screen tall: a shorter placeholder left the
// footer on screen, and the page arriving then shoved it down (layout shift).
export function LandingSkeleton() {
  return (
    <div className="w-full min-h-screen animate-pulse" aria-hidden="true">
      <div className="mx-auto max-w-5xl px-4 pt-24 pb-16 flex flex-col items-center gap-5">
        <div className="h-10 w-2/3 rounded-lg bg-gray-200/70" />
        <div className="h-5 w-1/2 rounded bg-gray-200/60" />
        <div className="mt-4 flex gap-3">
          <div className="h-11 w-36 rounded-lg bg-gray-200/70" />
          <div className="h-11 w-36 rounded-lg bg-gray-200/50" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 grid grid-cols-1 sm:grid-cols-3 gap-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-56 rounded-2xl bg-gray-200/50" />
        ))}
      </div>
    </div>
  )
}
