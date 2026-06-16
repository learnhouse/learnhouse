'use client'

import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'

const COLOR_CLASSES: Record<string, string> = {
  blue: 'bg-blue-600 hover:bg-blue-700 text-white',
  black: 'bg-gray-900 hover:bg-gray-800 text-white',
  green: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  red: 'bg-rose-600 hover:bg-rose-700 text-white',
  gray: 'bg-gray-100 hover:bg-gray-200 text-gray-900',
}

const ALIGNMENT_CLASSES: Record<string, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
}

export default function ButtonsComponent(props: any) {
  const emoji: string = props.node.attrs.emoji ?? '🔗'
  const link: string = props.node.attrs.link ?? ''
  const color: string = props.node.attrs.color ?? 'blue'
  const alignment: string = props.node.attrs.alignment ?? 'left'
  const colorClasses = COLOR_CLASSES[color] ?? COLOR_CLASSES.blue
  const alignClasses = ALIGNMENT_CLASSES[alignment] ?? ALIGNMENT_CLASSES.left

  const button = (
    <span
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${colorClasses}`}
    >
      <span aria-hidden="true">{emoji}</span>
      <NodeViewContent />
    </span>
  )

  return (
    <NodeViewWrapper>
      <div className={`my-2 flex ${alignClasses}`}>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer">
            {button}
          </a>
        ) : (
          button
        )}
      </div>
    </NodeViewWrapper>
  )
}
