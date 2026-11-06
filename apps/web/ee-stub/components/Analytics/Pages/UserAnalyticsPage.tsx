import { notFound } from 'next/navigation'

// OSS stub: per-user analytics require Enterprise Edition.
export default function UserAnalyticsPage(_props: { params: Promise<{ orgslug: string; userId: string }> }) {
  notFound()
}
