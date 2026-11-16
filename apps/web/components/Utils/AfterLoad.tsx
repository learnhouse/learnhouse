'use client'
import React, { useEffect, useState } from 'react'
import { onAfterLoad } from '@/lib/afterLoad'

/**
 * Renders its children only once the page has loaded and the browser is idle.
 * For floating, non-essential widgets whose code would otherwise download in
 * the same burst as the page's own chunks and push back its first paint.
 */
export default function AfterLoad({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => onAfterLoad(() => setReady(true)), [])
  return ready ? <>{children}</> : null
}
