'use client'
import { useEffect, useState } from 'react'

/**
 * Whether the browser runs on an Apple platform, for shortcut hints only
 * (⌘ versus Ctrl). The keyboard handlers themselves accept either modifier,
 * so a wrong guess changes the label, never the behaviour.
 *
 * Starts as `true` and settles after mount, so the server and the first
 * client render agree.
 */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const platform =
      (navigator as any).userAgentData?.platform || navigator.platform || navigator.userAgent
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(platform))
  }, [])

  return isMac
}
