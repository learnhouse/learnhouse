import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import StyleGuide from './StyleGuide'

// Living style guide for the V2 design system (design/DESIGN.md). Development
// only: production builds answer 404, and nothing links here (no nav entry,
// not in the sitemap).
export const metadata: Metadata = {
  title: 'Design system',
  robots: { index: false, follow: false },
}

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <StyleGuide />
}
