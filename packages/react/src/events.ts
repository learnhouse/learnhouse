import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { LearnHouseEvent } from './types'

interface Options {
  enabled: boolean
  activityId?: string
  linkTarget: '_blank' | '_self' | '_parent' | '_top'
  onLinkClick?: (href: string, event: MouseEvent) => boolean | void
  trackCompletion: boolean
}

const READY_SELECTOR = '.lh-static-canva > *, .lh-assignment > *, video, iframe, .markdown-body, img'
const PROGRESS_EVERY_MS = 5000
const COMPLETION_SETTLE_MS = 1500

/**
 * DOM-level events of the rendered activity: links, media playback, size,
 * visibility, readiness and completion. Listening on the root keeps the
 * block components themselves unchanged.
 */
export function useRendererEvents(
  rootRef: RefObject<HTMLDivElement | null>,
  emit: (event: LearnHouseEvent) => void,
  options: Options,
) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const root = rootRef.current
    if (!root || !options.enabled) return
    const cleanups: (() => void)[] = []
    let armCompletion = () => {}

    // Links: let the host intercept, then open where it asked.
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || !root.contains(anchor) || event.defaultPrevented) return
      const href = anchor.href
      const external = anchor.origin !== window.location.origin
      emit({ type: 'link_click', href, external })
      const { onLinkClick, linkTarget } = optionsRef.current
      if (onLinkClick?.(href, event) === false) {
        event.preventDefault()
        return
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      if ((anchor.target || '_self') !== linkTarget) {
        event.preventDefault()
        if (linkTarget === '_blank') window.open(href, '_blank', 'noopener,noreferrer')
        else (linkTarget === '_self' ? window : linkTarget === '_parent' ? window.parent : window.top)!.location.assign(href)
      }
    }
    root.addEventListener('click', onClick)
    cleanups.push(() => root.removeEventListener('click', onClick))

    // Media: these events don't bubble, so listen in the capture phase.
    const lastProgress = new WeakMap<EventTarget, number>()
    const onMedia = (event: Event) => {
      const el = event.target as HTMLMediaElement
      if (!(el instanceof HTMLMediaElement)) return
      let action: 'play' | 'pause' | 'ended' | 'progress'
      if (event.type === 'timeupdate') {
        const now = Date.now()
        if (now - (lastProgress.get(el) ?? 0) < PROGRESS_EVERY_MS) return
        lastProgress.set(el, now)
        action = 'progress'
      } else {
        action = event.type as 'play' | 'pause' | 'ended'
      }
      emit({
        type: 'media',
        action,
        media: el instanceof HTMLVideoElement ? 'video' : 'audio',
        src: el.currentSrc,
        currentTime: el.currentTime,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
      })
    }
    for (const type of ['play', 'pause', 'ended', 'timeupdate']) {
      root.addEventListener(type, onMedia, true)
      cleanups.push(() => root.removeEventListener(type, onMedia, true))
    }

    // Size: hosts use it to size an iframe or a modal around the content.
    if (typeof ResizeObserver !== 'undefined') {
      let last = ''
      const ro = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect
        const key = `${Math.round(width)}x${Math.round(height)}`
        if (key === last) return
        last = key
        emit({ type: 'resize', width: Math.round(width), height: Math.round(height) })
      })
      ro.observe(root)
      cleanups.push(() => ro.disconnect())
    }

    if (typeof IntersectionObserver !== 'undefined') {
      let seen = false
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !seen) {
            seen = true
            emit({ type: 'visible', ratio: entry.intersectionRatio })
          }
        },
        { threshold: [0, 0.5] },
      )
      io.observe(root)
      cleanups.push(() => io.disconnect())

      // Completion is armed only once content is in and layout has settled,
      // or lazy blocks still loading would leave the end of the page in view.
      armCompletion = () => {
        const sentinel = sentinelRef.current
        if (!sentinel || !optionsRef.current.trackCompletion) return
        let done = false
        const end = new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting && !done) {
            done = true
            emit({ type: 'complete', activityId: optionsRef.current.activityId })
          }
        })
        end.observe(sentinel)
        cleanups.push(() => end.disconnect())
      }
    }

    // Ready: block code is lazy, so watch for the first real content.
    let ready = false
    const checkReady = () => {
      if (!ready && root.querySelector(READY_SELECTOR)) {
        ready = true
        emit({ type: 'ready' })
        const timer = setTimeout(() => armCompletion(), COMPLETION_SETTLE_MS)
        cleanups.push(() => clearTimeout(timer))
        return true
      }
      return false
    }
    if (!checkReady()) {
      const mo = new MutationObserver(() => checkReady() && mo.disconnect())
      mo.observe(root, { childList: true, subtree: true })
      cleanups.push(() => mo.disconnect())
    }

    return () => cleanups.forEach((fn) => fn())
  }, [rootRef, emit, options.enabled])

  return { sentinelRef }
}
