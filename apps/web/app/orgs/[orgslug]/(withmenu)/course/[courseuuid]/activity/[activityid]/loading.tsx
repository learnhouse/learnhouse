import OrgPageSkeleton from '@components/Objects/Loaders/OrgPageSkeleton'

// In-pane placeholder: the header stays put and only the body pulses (this
// used to be a full-screen spinner over the whole page, menu included).
export default function Loading() {
  return <OrgPageSkeleton variant="activity" />
}
