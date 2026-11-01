'use client'
import React, { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Hash } from 'lucide-react'
import { isCommunityUuid } from './communityTags'

const CommunityHoverCard = dynamic(() => import('./CommunityHoverCard'), { ssr: false })

// "#Community": hover (or click) for its discussions in a card.
export default function CommunityTagChip({ communityUuid, name }: { communityUuid: string; name: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)
  const openTimer = useRef<number | undefined>(undefined)

  const show = () => {
    window.clearTimeout(closeTimer.current)
    openTimer.current = window.setTimeout(() => setOpen(true), 200)
  }
  const hide = () => {
    window.clearTimeout(openTimer.current)
    if (pinned) return
    closeTimer.current = window.setTimeout(() => setOpen(false), 300)
  }

  // A pinned card (clicked open) closes on a click elsewhere.
  useEffect(() => {
    if (!pinned) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || (target as Element)?.closest?.('[data-community-card]')) return
      setPinned(false)
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pinned])

  useEffect(() => () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }, [])

  // A malformed uuid never reaches the API: show the name, nothing more.
  if (!isCommunityUuid(communityUuid)) return <span>#{name}</span>

  return (
    <span
      ref={ref}
      contentEditable={false}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        setPinned(true)
        setOpen(true)
      }}
      className="inline-flex cursor-pointer items-center gap-0.5 rounded-md bg-sky-50 px-1.5 py-0.5 align-baseline text-[0.92em] font-medium leading-none text-sky-700 ring-1 ring-inset ring-sky-200 hover:bg-sky-100"
    >
      <Hash size={12} className="opacity-70" />
      {name}
      {open && ref.current && (
        <CommunityHoverCard communityUuid={communityUuid} anchor={ref.current} onMouseEnter={show} onMouseLeave={hide} />
      )}
    </span>
  )
}
