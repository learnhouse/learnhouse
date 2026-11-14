import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Organization Details',
}

export default function OrgDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
