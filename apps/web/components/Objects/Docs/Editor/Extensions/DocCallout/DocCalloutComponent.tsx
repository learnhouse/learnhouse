'use client'

import React from 'react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { Info, AlertTriangle, CheckCircle, Lightbulb } from 'lucide-react'
import type { DocCalloutVariant } from './DocCallout'

const variantConfig: Record<
  DocCalloutVariant,
  { icon: React.ReactNode; bg: string; border: string; iconColor: string }
> = {
  info: {
    icon: <Info size={16} />,
    bg: 'bg-blue-50',
    border: 'border-blue-400',
    iconColor: 'text-blue-500',
  },
  warning: {
    icon: <AlertTriangle size={16} />,
    bg: 'bg-amber-50',
    border: 'border-amber-400',
    iconColor: 'text-amber-500',
  },
  success: {
    icon: <CheckCircle size={16} />,
    bg: 'bg-green-50',
    border: 'border-green-400',
    iconColor: 'text-green-500',
  },
  tip: {
    icon: <Lightbulb size={16} />,
    bg: 'bg-purple-50',
    border: 'border-purple-400',
    iconColor: 'text-purple-500',
  },
}

export const DocCalloutComponent = ({ node }: { node: any }) => {
  const variant = (node.attrs.variant || 'info') as DocCalloutVariant
  const config = variantConfig[variant]

  return (
    <NodeViewWrapper>
      <div
        className={`flex items-start gap-3 rounded-lg border-l-4 p-4 my-2 ${config.bg} ${config.border}`}
      >
        <span className={`mt-0.5 flex-shrink-0 ${config.iconColor}`}>
          {config.icon}
        </span>
        <NodeViewContent className="flex-1 text-sm leading-relaxed outline-none" />
      </div>
    </NodeViewWrapper>
  )
}

export default DocCalloutComponent
