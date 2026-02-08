'use client'

import React, { Suspense, lazy, useMemo } from 'react'
import { FileText } from 'lucide-react'

interface PhosphorIconRendererProps {
  iconName?: string | null
  size?: number
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
  className?: string
}

// Lazy-load the entire phosphor icons module and pick the icon by name
const iconCache = new Map<string, React.LazyExoticComponent<any>>()

function getLazyIcon(name: string) {
  if (iconCache.has(name)) return iconCache.get(name)!
  const LazyIcon = lazy(() =>
    import('@phosphor-icons/react').then((mod) => {
      const Icon = (mod as any)[name]
      if (!Icon) {
        return { default: () => null }
      }
      return { default: Icon }
    })
  )
  iconCache.set(name, LazyIcon)
  return LazyIcon
}

const PhosphorIconRenderer = ({
  iconName,
  size = 16,
  weight = 'fill',
  className = '',
}: PhosphorIconRendererProps) => {
  const LazyIcon = useMemo(
    () => (iconName ? getLazyIcon(iconName) : null),
    [iconName]
  )

  if (!LazyIcon) {
    return <FileText size={size} className={className} />
  }

  return (
    <Suspense fallback={<FileText size={size} className={className} />}>
      <LazyIcon size={size} weight={weight} className={className} />
    </Suspense>
  )
}

export default PhosphorIconRenderer
