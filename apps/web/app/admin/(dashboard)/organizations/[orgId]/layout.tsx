import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Organization Details',
}

export default function OrgDetailLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
