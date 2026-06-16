'use client'

import { NodeViewWrapper } from '@tiptap/react'

const NODE_LABELS: Record<string, string> = {
  flipcard: 'Flip card',
  scenarios: 'Scenario',
  blockCode: 'Code playground',
  blockUser: 'User mention',
  blockWebPreview: 'Web preview',
  blockMagic: 'AI block',
}

export default function FallbackBlockComponent(props: any) {
  const label = NODE_LABELS[props.node.type.name] ?? 'Block'
  return (
    <NodeViewWrapper>
      <div className="my-2 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500 border border-dashed border-gray-200">
        <span className="font-medium text-gray-600">{label}</span>
        <span className="ml-2 text-gray-400">— open in LearnHouse to view</span>
      </div>
    </NodeViewWrapper>
  )
}
