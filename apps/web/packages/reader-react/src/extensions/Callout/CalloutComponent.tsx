'use client'

import { useState } from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'

type CalloutType = 'info' | 'warning' | 'tip' | 'success' | 'error'

const STYLES: Record<
  CalloutType,
  { bg: string; text: string; iconColor: string; icon: string }
> = {
  info: { bg: 'bg-gray-100', text: 'text-gray-700', iconColor: 'text-gray-500', icon: 'ℹ' },
  warning: { bg: 'bg-yellow-100', text: 'text-yellow-900', iconColor: 'text-yellow-600', icon: '⚠' },
  tip: { bg: 'bg-green-50', text: 'text-green-900', iconColor: 'text-green-600', icon: '💡' },
  success: { bg: 'bg-teal-50', text: 'text-teal-900', iconColor: 'text-teal-600', icon: '✓' },
  error: { bg: 'bg-red-50', text: 'text-red-900', iconColor: 'text-red-600', icon: '✕' },
}

function resolveType(node: any): CalloutType {
  if (node.type.name === 'calloutInfo') return 'info'
  if (node.type.name === 'calloutWarning') return 'warning'
  const t = node.attrs?.type as CalloutType | undefined
  return t && t in STYLES ? t : 'info'
}

export default function CalloutComponent(props: any) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const calloutType = resolveType(props.node)
  const style = STYLES[calloutType]
  const dismissible = props.node?.attrs?.dismissible

  return (
    <NodeViewWrapper>
      <div
        className={`w-full flex relative my-4 items-start rounded-xl shadow-inner gap-3 py-3 px-4 ${style.bg} ${style.text}`}
      >
        <span className={`shrink-0 mt-[3px] ${style.iconColor}`} aria-hidden="true">
          {style.icon}
        </span>
        <div className="grow min-w-0">
          <NodeViewContent className="content" />
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 mt-0.5 cursor-pointer p-0.5 rounded-full hover:bg-black/10 transition-colors"
          >
            ×
          </button>
        )}
      </div>
    </NodeViewWrapper>
  )
}
