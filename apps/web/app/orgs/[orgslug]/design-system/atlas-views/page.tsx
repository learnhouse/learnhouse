import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import AtlasViewsGallery from './AtlasViewsGallery'

// Dev-only gallery of every Atlas view component (render_view) with sample
// data, dark and light. Production builds answer 404; nothing links here.
export const metadata: Metadata = {
  title: 'Atlas views',
  robots: { index: false, follow: false },
}

export default function AtlasViewsPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <AtlasViewsGallery />
}
