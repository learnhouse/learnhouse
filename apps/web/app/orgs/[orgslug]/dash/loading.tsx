import DashPageSkeleton from '@components/Dashboard/Shared/DashPageSkeleton'

// Instant feedback for any dashboard page reached without a full prefetch:
// the click commits at once and this fills the pane (the sidebar and other
// layouts stay mounted) until the page arrives. Sidebar and tab links
// prefetch in full, so they skip it.
export default function Loading() {
  return <DashPageSkeleton />
}
