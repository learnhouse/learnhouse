'use client'

import { usePathname } from 'next/navigation'
import { activeTab } from './sections'

// Tags the page with its docs section so styles.css can pick that section's
// accent color (step numbers, list markers).
export default function SectionMain({ children }) {
  const section = activeTab(usePathname()).key
  return (
    <main className="lh-main" data-section={section}>
      {children}
    </main>
  )
}
