'use client'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { useTranslation } from 'react-i18next'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import {
  Info,
  Warning,
  Lightbulb,
  CheckCircle,
  XCircle,
  X,
  PushPin,
  Star,
  Fire,
  Target,
  Question,
  BookOpen,
  Brain,
  Rocket,
  Flag,
  Heart,
  Clock,
  ShieldCheck,
  Megaphone,
  NotePencil,
  GraduationCap,
} from '@phosphor-icons/react'
import React, { useEffect, useRef, useState } from 'react'

export type CalloutType = 'info' | 'warning' | 'tip' | 'success' | 'error'

const CALLOUT_TYPES: Record<
  CalloutType,
  {
    labelKey: string
    Icon: React.ElementType
    bg: string
    text: string
    iconColor: string
    ring: string
  }
> = {
  info: {
    labelKey: 'editor.blocks.callout_block.type_info',
    Icon: Info,
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    iconColor: 'text-gray-500',
    ring: 'ring-gray-200',
  },
  warning: {
    labelKey: 'editor.blocks.callout_block.type_warning',
    Icon: Warning,
    bg: 'bg-yellow-100',
    text: 'text-yellow-900',
    iconColor: 'text-yellow-600',
    ring: 'ring-yellow-300',
  },
  tip: {
    labelKey: 'editor.blocks.callout_block.type_tip',
    Icon: Lightbulb,
    bg: 'bg-green-50',
    text: 'text-green-900',
    iconColor: 'text-green-500',
    ring: 'ring-green-200',
  },
  success: {
    labelKey: 'editor.blocks.callout_block.type_success',
    Icon: CheckCircle,
    bg: 'bg-teal-50',
    text: 'text-teal-900',
    iconColor: 'text-teal-500',
    ring: 'ring-teal-200',
  },
  error: {
    labelKey: 'editor.blocks.callout_block.type_error',
    Icon: XCircle,
    bg: 'bg-red-50',
    text: 'text-red-900',
    iconColor: 'text-red-500',
    ring: 'ring-red-200',
  },
}

// Icons an author can pick instead of the type's default (stored by key).
export const CALLOUT_ICONS: Record<string, React.ElementType> = {
  info: Info,
  warning: Warning,
  lightbulb: Lightbulb,
  check: CheckCircle,
  error: XCircle,
  pin: PushPin,
  star: Star,
  fire: Fire,
  target: Target,
  question: Question,
  book: BookOpen,
  brain: Brain,
  rocket: Rocket,
  flag: Flag,
  heart: Heart,
  clock: Clock,
  shield: ShieldCheck,
  megaphone: Megaphone,
  note: NotePencil,
  graduation: GraduationCap,
}
const CALLOUT_EMOJIS = ['💡', '⚠️', '📌', '✅', '❗', '🔥', '📝', '🎯', '🚀', '🧠', '👉', '🎉']

/** The icon a callout shows: a picked icon/emoji, else its type's icon. */
function CalloutIcon({ icon, Fallback, size = 18 }: { icon: string | null; Fallback: React.ElementType; size?: number }) {
  if (icon && CALLOUT_ICONS[icon]) {
    const Picked = CALLOUT_ICONS[icon]
    return <Picked size={size} weight="fill" />
  }
  if (icon && !/^[a-z]+$/.test(icon)) {
    return <span aria-hidden className="inline-block text-center leading-none" style={{ fontSize: size - 1, width: size }}>{icon}</span>
  }
  return <Fallback size={size} weight="fill" />
}

function resolveType(node: any): CalloutType {
  if (node.type.name === 'calloutInfo') return 'info'
  if (node.type.name === 'calloutWarning') return 'warning'
  return (node.attrs?.type as CalloutType) || 'info'
}

function CalloutComponent(props: any) {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = editorState?.isEditable ?? false
  const [dismissed, setDismissed] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const iconBtnRef = useRef<HTMLButtonElement>(null)

  const dismissible = props.node?.attrs?.dismissible || false
  const pickedIcon: string | null = props.node?.type?.name === 'callout' ? props.node?.attrs?.icon || null : null
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
      // (old callouts hold inline text, the unified one holds paragraphs)
      const pos = typeof props.getPos === 'function' ? props.getPos() : 0
      const inlineContent = props.node?.content?.toJSON() ?? []
      props.editor
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + props.node.nodeSize })
        .insertContentAt(pos, {
          type: 'callout',
          attrs: { type: newType },
          content: [
            inlineContent.length > 0
              ? { type: 'paragraph', content: inlineContent }
              : { type: 'paragraph' },
          ],
        })
        .run()
    }
    setShowPicker(false)
  }

  if (dismissed) return null

  return (
    <NodeViewWrapper>
    <EditorBlockFrame editable={isEditable} node={props.node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="info" editableContent>
      <div
        className={`w-full flex relative my-4 items-start rounded-xl shadow-inner gap-3 py-3 px-4 ${config.bg} ${config.text} ${isEditable ? 'ring-1 ring-inset ring-black/[0.06]' : ''}`}
        contentEditable={isEditable || undefined}
        suppressContentEditableWarning={true}
      >
        {/* Icon: clickable type-switcher trigger in edit mode */}
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
              title={t('editor.blocks.callout_block.change_type')}
            >
              <CalloutIcon icon={pickedIcon} Fallback={Icon} />
            </button>
          ) : (
            <span className={`${config.iconColor} mt-[3px] block`}>
              <CalloutIcon icon={pickedIcon} Fallback={Icon} />
            </span>
          )}

          {/* Type picker */}
          {showPicker && isEditable && (
            <div
              ref={pickerRef}
              contentEditable={false}
              className="absolute top-8 start-0 z-50 bg-white rounded-xl shadow-lg ring-1 ring-black/10 py-1.5 w-[228px] overflow-hidden"
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
                      {t(cfg.labelKey)}
                    </button>
                  )
                }
              )}
              {props.node?.type?.name === 'callout' && (
                <>
                  <div className="mx-3 my-1.5 h-px bg-gray-100" />
                  <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {t('editor.blocks_v2.callout_icon', 'Icon')}
                  </div>
                  <div className="grid grid-cols-6 gap-0.5 px-2 pb-1">
                    {Object.entries(CALLOUT_ICONS).map(([key, PickIcon]) => (
                      <button
                        key={key}
                        type="button"
                        title={key}
                        aria-label={key}
                        aria-pressed={pickedIcon === key}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          props.updateAttributes({ icon: key })
                        }}
                        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${pickedIcon === key ? 'bg-gray-900 text-white' : `${config.iconColor} hover:bg-gray-100`}`}
                      >
                        <PickIcon size={15} weight="fill" />
                      </button>
                    ))}
                    {CALLOUT_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        aria-pressed={pickedIcon === emoji}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          props.updateAttributes({ icon: emoji })
                        }}
                        className={`flex h-7 w-7 items-center justify-center rounded-md text-[15px] transition-colors ${pickedIcon === emoji ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  {pickedIcon && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        props.updateAttributes({ icon: null })
                      }}
                      className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-md px-2 py-1 text-start text-xs text-gray-500 hover:bg-gray-50"
                    >
                      {t('editor.blocks_v2.callout_icon_reset', 'Use the default icon')}
                    </button>
                  )}
                  <label
                    className="mx-2 mb-1 flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <span>{t('editor.blocks_v2.callout_dismissible', 'Learners can dismiss it')}</span>
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-gray-900"
                      checked={!!dismissible}
                      onChange={(e) => props.updateAttributes({ dismissible: e.target.checked })}
                    />
                  </label>
                </>
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
    </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default CalloutComponent
