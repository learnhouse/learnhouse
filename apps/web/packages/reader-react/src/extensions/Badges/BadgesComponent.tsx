'use client'

import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'

const COLOR_CLASSES: Record<string, string> = {
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  gray: 'bg-gray-100 text-gray-700 ring-gray-200',
}

export default function BadgesComponent(props: any) {
  const color: string = props.node.attrs.color ?? 'sky'
  const emoji: string = props.node.attrs.emoji ?? '💡'
  const classes = COLOR_CLASSES[color] ?? COLOR_CLASSES.sky
  return (
    <NodeViewWrapper>
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${classes}`}
      >
        <span aria-hidden="true">{emoji}</span>
        <NodeViewContent />
      </span>
    </NodeViewWrapper>
  )
}
