'use client'
import React, { useState } from 'react'
import { cn } from '@/lib/utils'

export const EMPTY_THUMBNAIL = '/empty_thumbnail.png'

interface ThumbnailImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | null | undefined
  /** Shown when src is empty or fails to load. */
  fallbackSrc?: string
}

/**
 * Cover-fit image that swaps to a placeholder when the file is missing or
 * fails to load, so a deleted upload never leaves an empty box.
 */
export default function ThumbnailImage({
  src,
  fallbackSrc = EMPTY_THUMBNAIL,
  className,
  alt = '',
  onError,
  ...props
}: ThumbnailImageProps) {
  // Tracking the failed URL resets automatically when src changes
  const [erroredSrc, setErroredSrc] = useState<string | null>(null)
  const resolved = src && src !== erroredSrc ? src : fallbackSrc

  return (
    <img
      {...props}
      src={resolved}
      alt={alt}
      className={cn('object-cover', className)}
      onError={(e) => {
        if (resolved !== fallbackSrc) setErroredSrc(resolved)
        onError?.(e)
      }}
    />
  )
}
