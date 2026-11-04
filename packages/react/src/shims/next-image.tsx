import React, { forwardRef } from 'react'

type StaticImport = { src: string; width?: number; height?: number }

interface ImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | StaticImport
  fill?: boolean
  priority?: boolean
  quality?: number | string
  unoptimized?: boolean
  placeholder?: string
  blurDataURL?: string
  loader?: unknown
  overrideSrc?: string
}

// next/image without the optimizer: a plain <img> that keeps sizing and
// lazy-loading behaviour close enough for a renderer inside another app.
const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  { src, fill, priority, quality: _q, unoptimized: _u, placeholder: _p, blurDataURL: _b, loader: _l, overrideSrc, style, width, height, loading, ...rest },
  ref,
) {
  const resolved = overrideSrc ?? (typeof src === 'string' ? src : src.src)
  const fillStyle: React.CSSProperties | undefined = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%' }
    : undefined
  return (
    <img
      ref={ref}
      src={resolved}
      width={fill ? undefined : (width ?? (typeof src === 'object' ? src.width : undefined))}
      height={fill ? undefined : (height ?? (typeof src === 'object' ? src.height : undefined))}
      loading={priority ? 'eager' : (loading ?? 'lazy')}
      decoding="async"
      style={{ ...fillStyle, ...style }}
      {...rest}
    />
  )
})

export default Image
