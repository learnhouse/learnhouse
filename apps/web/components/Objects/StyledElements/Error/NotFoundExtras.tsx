'use client'
import { ArrowLeft } from 'lucide-react'
import { usePathname } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import { ErrorButton } from './ErrorShell'

/** The address that missed, so a typo is easy to spot. */
export function RequestedPath() {
  const pathname = usePathname()
  if (!pathname || pathname === '/') return null
  return (
    <code
      dir="ltr"
      className="max-w-full truncate rounded-lg bg-gray-50 px-2.5 py-1 font-mono text-xs text-gray-500 ring-1 ring-gray-100"
    >
      {pathname}
    </code>
  )
}

/** "Go back" only when there's somewhere to go back to. */
export function GoBackButton() {
  const [canGoBack, setCanGoBack] = useState(false)
  useEffect(() => setCanGoBack(window.history.length > 1), [])
  if (!canGoBack) return null
  return (
    <ErrorButton
      onClick={() => window.history.back()}
      label="Go back"
      icon={<ArrowLeft size={15} className="rtl:rotate-180" />}
    />
  )
}
