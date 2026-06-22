'use client'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import {
  Info,
  Warning,
  Lightbulb,
  CheckCircle,
  XCircle,
  X,
} from '@phosphor-icons/react'
import React, { useEffect, useRef, useState } from 'react'

export type CalloutType = 'info' | 'warning' | 'tip' | 'success' | 'error'

const CALLOUT_TYPES: Record<
  CalloutType,
  {
    label: string
    Icon: React.ElementType
    bg: string
    text: string
    iconColor: string
    ring: string
  }
> = {
  info: {
    label: 'Info',
    Icon: Info,
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    iconColor: 'text-gray-500',
    ring: 'ring-gray-200',
  },
  warning: {
    label: 'Warning',
    Icon: Warning,
    bg: 'bg-yellow-100',
    text: 'text-yellow-900',
    iconColor: 'text-yellow-600',
    ring: 'ring-yellow-300',
  },
  tip: {
    label: 'Tip',
    Icon: Lightbulb,
    bg: 'bg-green-50',
    text: 'text-green-900',
    iconColor: 'text-green-500',
    ring: 'ring-green-200',
  },
  success: {
    label: 'Success',
    Icon: CheckCircle,
    bg: 'bg-teal-50',
    text: 'text-teal-900',
    iconColor: 'text-teal-500',
    ring: 'ring-teal-200',
  },
  error: {
    label: 'Error',
    Icon: XCircle,
    bg: 'bg-red-50',
    text: 'text-red-900',
    iconColor: 'text-red-500',
    ring: 'ring-red-200',
  },
}

function resolveType(node: any): CalloutType {
  if (node.type.name === 'calloutInfo') return 'info'
  if (node.type.name === 'calloutWarning') return 'warning'
  return (node.attrs?.type as CalloutType) || 'info'
}

function CalloutComponent(props: any) {
  const editorState = useEditorProvider() as any
  const isEditable = editorState?.isEditable ?? false
  const [dismissed, setDismissed] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const iconBtnRef = useRef<HTMLButtonElement>(null)

  const dismissible = props.node?.attrs?.dismissible || false
  const calloutType = resolveType(props.node)
  const config = CALLOUT_TYPES[calloutType]
  const { Icon } = config

  useEffect(() => {
    if (!showPicker) return
    const handleClick = (e: MouseEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        iconBtnRef.current && !iconBtnRef.current.contains(e.target as Node)
      ) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPicker])

  const handleTypeChange = (newType: CalloutType) => {
    const nodeName = props.node?.type?.name
    if (nodeName === 'callout') {
      props.updateAttributes({ type: newType })
    } else {
      // Old node: replace with new unified callout node, preserving content
      const pos = typeof props.getPos === 'function' ? props.getPos() : 0
      const textContent = props.node?.textContent || ''
      props.editor
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + props.node.nodeSize })
        .insertContentAt(pos, {
          type: 'callout',
          attrs: { type: newType },
          content: textContent ? [{ type: 'text', text: textContent }] : [],
        })
        .run()
    }
    setShowPicker(false)
  }

  if (dismissed) return null

  return (
    <NodeViewWrapper>
      <div
        className={`w-full flex relative my-4 items-start rounded-xl shadow-inner gap-3 py-3 px-4 ${config.bg} ${config.text} ${isEditable ? 'ring-1 ring-inset ring-black/[0.06]' : ''}`}
        contentEditable={isEditable || undefined}
        suppressContentEditableWarning={true}
      >
        {/* Icon — clickable type-switcher trigger in edit mode */}
        <div className="relative shrink-0">
          {isEditable ? (
            <button
              ref={iconBtnRef}
              type="button"
              contentEditable={false}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setShowPicker((v) => !v)
              }}
              className={`${config.iconColor} mt-[3px] hover:opacity-70 transition-opacity cursor-pointer`}
              title="Change callout type"
            >
              <Icon size={18} weight="fill" />
            </button>
          ) : (
            <span className={`${config.iconColor} mt-[3px] block`}>
              <Icon size={18} weight="fill" />
            </span>
          )}

          {/* Type picker */}
          {showPicker && isEditable && (
            <div
              ref={pickerRef}
              contentEditable={false}
              className="absolute top-8 left-0 z-50 bg-white rounded-xl shadow-lg ring-1 ring-black/10 py-1.5 min-w-[140px] overflow-hidden"
            >
              {(Object.entries(CALLOUT_TYPES) as [CalloutType, typeof CALLOUT_TYPES[CalloutType]][]).map(
                ([type, cfg]) => {
                  const PickerIcon = cfg.Icon
                  const isActive = type === calloutType
                  return (
                    <button
                      key={type}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleTypeChange(type)
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors ${
                        isActive
                          ? `${cfg.bg} ${cfg.text} font-medium`
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <PickerIcon size={15} weight="fill" className={isActive ? cfg.iconColor : 'text-gray-400'} />
                      {cfg.label}
                    </button>
                  )
                }
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="grow min-w-0">
          <NodeViewContent className="content" />
        </div>

        {/* Dismiss button */}
        {dismissible && !isEditable && (
          <button
            contentEditable={false}
            onClick={() => setDismissed(true)}
            className="shrink-0 mt-0.5 cursor-pointer p-0.5 rounded-full hover:bg-black/10 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default CalloutComponent
