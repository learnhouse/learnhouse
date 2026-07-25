'use client'

import BoundaryError from '@components/Objects/StyledElements/Error/BoundaryError'

/**
 * Segment-level boundary for the course editor.
 *
 * Without one, a render-phase crash in a single tab (a chapter row, a lock
 * popover, the structure tree) unmounted the entire dashboard and left the user
 * on a blank page with no way back. Keeping the boundary here means the failure
 * is contained to the tab body — the surrounding dashboard chrome survives and
 * the retry action re-renders just this subtree.
 */
export default function CourseEditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <BoundaryError error={error} reset={reset} />
}
