'use client'
import React, { useRef, useState, useEffect } from 'react'

export default function LazyAnalyticsWidget({
  children,
  className,
  minHeight = 300,
}: {
  children: React.ReactNode
  className?: string
  minHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '100px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className={className} style={{ minHeight }}>
      {visible ? children : null}
    </div>
  )
}
