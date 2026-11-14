import DashPageSkeleton from '@components/Dashboard/Shared/DashPageSkeleton'

// In-pane placeholder (the sidebar stays put), shown only when the page was
// not prefetched. It used to be a full-screen spinner over everything.
export default function Loading() {
  return <DashPageSkeleton />
}
