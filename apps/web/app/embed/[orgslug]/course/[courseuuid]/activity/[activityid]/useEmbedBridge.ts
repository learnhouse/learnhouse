'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { embedMessage, isHostMessage, type EmbedEventType } from '@/lib/embed/protocol'

/**
 * Tells the page that frames this embed what happens inside it: when it is
 * ready, its content height (so public/embed.js can size the iframe), when the
 * learner reaches the end, media playback and link clicks. Does nothing when
 * the page isn't framed.
 *
 * Any site can frame an embed, and messages go to '*', so they carry no
 * content: no media URLs, no link targets, nothing a signed-in visitor sees
 * that the framing site couldn't.
 */
const SETTLE_MS = 800

export function useEmbedBridge({
  activityId,
  ready,
  containerRef,
  endRef,
}: {
  activityId: string
  ready: boolean
  containerRef: RefObject<HTMLElement | null>
  endRef: RefObject<HTMLElement | null>
}) {
  const lastHeight = useRef(0)

  useEffect(() => {
    if (!ready || typeof window === 'undefined' || window.parent === window) return
    const post = (type: EmbedEventType, data?: Record<string, unknown>) =>
      window.parent.postMessage(embedMessage(type, activityId, data), '*')

    const container = containerRef.current
    const sendSize = (force = false) => {
      if (!container) return
      const height = Math.ceil(container.getBoundingClientRect().height)
      if (!force && height === lastHeight.current) return
      lastHeight.current = height
      post('resize', { height, width: Math.ceil(container.getBoundingClientRect().width) })
    }

    post('ready')
    sendSize(true)

    // Start watching for the end only once the height has settled: while
    // images load, the end marker can sit in view for a moment.
    const endObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) complete('scrolled_to_end')
    })
    let armTimer: ReturnType<typeof setTimeout> | undefined
    const armEndObserver = () => {
      clearTimeout(armTimer)
      armTimer = setTimeout(() => {
        if (endRef.current) endObserver.observe(endRef.current)
      }, SETTLE_MS)
    }

    let frame = 0
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => sendSize())
      armEndObserver()
    })
    if (container) resizeObserver.observe(container)
    armEndObserver()

    // The host asks for the current size when its script loads after the iframe.
    const onHostMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !isHostMessage(event.data)) return
      if (event.data.type === 'hello') {
        post('ready')
        sendSize(true)
      }
    }
    window.addEventListener('message', onHostMessage)

    let completed = false
    const complete = (reason: string) => {
      if (completed) return
      completed = true
      post('complete', { reason })
    }

    const onMedia = (event: Event) => {
      const el = event.target
      if (!(el instanceof HTMLMediaElement)) return
      const action = event.type === 'playing' ? 'play' : event.type
      post('media', {
        action,
        media: el instanceof HTMLVideoElement ? 'video' : 'audio',
        currentTime: el.currentTime,
        duration: Number.isFinite(el.duration) ? el.duration : null,
      })
      if (event.type === 'ended') complete('media_ended')
    }
    const mediaEvents = ['playing', 'pause', 'ended']
    for (const type of mediaEvents) document.addEventListener(type, onMedia, true)

    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link) return
      post('link_click', { external: link.origin !== window.location.origin })
    }
    document.addEventListener('click', onClick, true)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(armTimer)
      resizeObserver.disconnect()
      endObserver.disconnect()
      window.removeEventListener('message', onHostMessage)
      for (const type of mediaEvents) document.removeEventListener(type, onMedia, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [ready, activityId, containerRef, endRef])
}

/**
 * Tells the host the activity can't be shown here. One signal for missing,
 * unpublished and non-embeddable activities, so a framing page can't probe
 * which unpublished activities exist.
 */
export function useEmbedUnavailable(activityId: string, unavailable: boolean) {
  useEffect(() => {
    if (!unavailable || typeof window === 'undefined' || window.parent === window) return
    window.parent.postMessage(embedMessage('unavailable', activityId), '*')
  }, [activityId, unavailable])
}
