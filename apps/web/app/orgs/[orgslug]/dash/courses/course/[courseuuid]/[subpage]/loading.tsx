// Body-only placeholder: the header and tabs come from ../layout.tsx and stay
// on screen while a tab loads, so only the cards below them pulse.
export default function Loading() {
  return (
    <div className="px-4 sm:px-10 pt-6 sm:pt-8 pb-16 animate-pulse">
      <div className="space-y-5">
        {[0, 1].map((i) => (
          <div key={i} className="bg-white rounded-2xl nice-shadow p-5 space-y-5">
            <div className="space-y-2">
              <div className="h-4 w-40 rounded bg-neutral-200" />
              <div className="h-3 w-72 max-w-full rounded bg-neutral-100" />
            </div>
            {[0, 1, 2].map((j) => (
              <div key={j} className="space-y-2">
                <div className="h-3 w-24 rounded bg-neutral-200" />
                <div className="h-9 w-full rounded-lg bg-neutral-100" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
