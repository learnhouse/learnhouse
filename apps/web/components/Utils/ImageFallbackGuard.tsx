'use client'
import { useEffect } from 'react'

const EMPTY_THUMBNAIL = '/empty_thumbnail.png'
const EMPTY_AVATAR = '/empty_avatar.png'

// Images inside these never get swapped: authored content should show what
// the author put there, and anything can opt out with data-no-image-fallback.
const SKIP_SELECTOR = '.ProseMirror, [data-no-image-fallback]'

function applyFallback(img: HTMLImageElement) {
  if (img.dataset.lhFallback) return
  if (img.closest(SKIP_SELECTOR)) return
  const src = img.getAttribute('src') || ''
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return
  if (src.includes(EMPTY_THUMBNAIL) || src.includes(EMPTY_AVATAR)) return

  const hint = `${img.className} ${img.alt}`.toLowerCase()
  const isAvatar = hint.includes('rounded-full') || hint.includes('avatar')
  img.dataset.lhFallback = '1'
  img.removeAttribute('srcset')
  img.src = isAvatar ? EMPTY_AVATAR : EMPTY_THUMBNAIL
  // The alt text of a broken image renders inside the box; the placeholder
  // carries no meaning of its own.
  img.alt = ''
  if (!img.style.objectFit) img.style.objectFit = 'cover'
}

/**
 * App-wide safety net for broken images. Many surfaces render a plain <img>
 * for uploaded media; when the file is missing the browser shows a broken
 * icon with its alt text spilling into the layout. Swap those for the
 * placeholder thumbnail (or the empty avatar) instead.
 */
export default function ImageFallbackGuard() {
  useEffect(() => {
    // Error events don't bubble, but they do reach a capturing listener.
    const onError = (event: Event) => {
      if (event.target instanceof HTMLImageElement) applyFallback(event.target)
    }
    window.addEventListener('error', onError, true)

    // Images that already failed before this ran (server-rendered markup).
    document.querySelectorAll('img').forEach((img) => {
      if (img.complete && img.naturalWidth === 0) applyFallback(img)
    })

    return () => window.removeEventListener('error', onError, true)
  }, [])

  return null
}
