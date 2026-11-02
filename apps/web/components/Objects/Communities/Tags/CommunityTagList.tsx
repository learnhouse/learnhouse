'use client'
import React, { forwardRef, useImperativeHandle, useState } from 'react'
import { Hash } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TaggableCommunity } from './communityTags'

export interface CommunityTagListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

const CommunityTagList = forwardRef<CommunityTagListRef, { items: TaggableCommunity[]; command: (c: TaggableCommunity) => void }>(
  ({ items, command }, ref) => {
    const { t } = useTranslation()
    const [selected, setSelected] = useState(0)
    const [prevItems, setPrevItems] = useState(items)
    if (items !== prevItems) {
      setPrevItems(items)
      setSelected(0)
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (!items.length) return false
        if (event.key === 'ArrowDown') {
          setSelected((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === 'ArrowUp') {
          setSelected((i) => (i - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          command(items[selected])
          return true
        }
        return false
      },
    }))

    return (
      <div className="w-72 rounded-xl bg-white p-1 shadow-lg ring-1 ring-black/10">
        <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {t('communities.tag.link_community', 'Link a community')}
        </div>
        {items.map((c, index) => (
          <button
            key={c.community_uuid}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(c)}
            onMouseEnter={() => setSelected(index)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm ${
              index === selected ? 'bg-sky-50 text-sky-900' : 'text-gray-700'
            }`}
          >
            <Hash size={14} className="shrink-0 text-sky-500" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{c.name}</span>
              {c.description && <span className="block truncate text-xs text-gray-400">{c.description}</span>}
            </span>
          </button>
        ))}
      </div>
    )
  }
)

CommunityTagList.displayName = 'CommunityTagList'

export default CommunityTagList
