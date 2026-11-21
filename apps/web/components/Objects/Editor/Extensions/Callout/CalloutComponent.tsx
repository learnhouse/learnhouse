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
  Flask,
  Quotes,
  CaretDown,
} from '@phosphor-icons/react'
import React, { useEffect, useRef, useState } from 'react'
import type { CalloutPickerProps } from './CalloutPicker'
import { CALLOUT_TONES, calloutAttrsFor, calloutStyleOf, calloutToneOf, type CalloutTone } from './calloutStyles'
import { lazyView } from '../Plus/lazyView'

// The type / icon / colour picker is editor UI: learners never load it.
const CalloutPicker = lazyView<CalloutPickerProps>('CalloutPicker', () => import('./CalloutPicker'))

export type CalloutType = 'info' | 'warning' | 'tip' | 'success' | 'error' | 'note' | 'question' | 'example' | 'quote'

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
  // Editor Plus types.
  note: {
    labelKey: 'editor.blocks.callout_block.type_note',
    Icon: NotePencil,
    bg: 'bg-sky-50',
    text: 'text-sky-950',
    iconColor: 'text-sky-500',
    ring: 'ring-sky-200',
  },
  question: {
    labelKey: 'editor.blocks.callout_block.type_question',
    Icon: Question,
    bg: 'bg-violet-50',
    text: 'text-violet-950',
    iconColor: 'text-violet-500',
    ring: 'ring-violet-200',
  },
  example: {
    labelKey: 'editor.blocks.callout_block.type_example',
    Icon: Flask,
    bg: 'bg-amber-50',
    text: 'text-amber-950',
    iconColor: 'text-amber-500',
    ring: 'ring-amber-200',
  },
  quote: {
    labelKey: 'editor.blocks.callout_block.type_quote',
    Icon: Quotes,
    bg: 'bg-stone-100',
    text: 'text-stone-800',
    iconColor: 'text-stone-400',
    ring: 'ring-stone-200',
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
  // Editor Plus kinds are read from `kind`; `type` holds a legacy fallback.
  return calloutStyleOf(node.attrs) as CalloutType
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
  const isUnified = props.node?.type?.name === 'callout'
  const pickedIcon: string | null = isUnified ? props.node?.attrs?.icon || null : null
  const calloutType = resolveType(props.node)
  const tone: CalloutTone | null = isUnified ? calloutToneOf(props.node?.attrs?.tone) : null
  // A tone repaints the callout; without one the type's own colours (the old look).
  const config = tone ? { ...CALLOUT_TYPES[calloutType], ...CALLOUT_TONES[tone] } : CALLOUT_TYPES[calloutType]
  const { Icon } = config
  const title: string = isUnified ? String(props.node?.attrs?.title || '') : ''
  const collapsible = isUnified && !!title && props.node?.attrs?.collapsible === true
  const startsOpen = props.node?.attrs?.defaultOpen !== false
  const [learnerOpen, setLearnerOpen] = useState(startsOpen)
  const bodyOpen = isEditable || !collapsible || learnerOpen
  const bodyId = React.useId()

  useEffect(() => {
    // Ready before the first click.
    if (isEditable) CalloutPicker.preload().catch(() => {})
  }, [isEditable])

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
      props.updateAttributes(calloutAttrsFor(newType))
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
          attrs: calloutAttrsFor(newType),
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

          {/* Type picker (editor only, a chunk of its own) */}
          {showPicker && isEditable && (
            <CalloutPicker
              pickerRef={pickerRef}
              node={props.node}
              updateAttributes={props.updateAttributes}
              types={CALLOUT_TYPES}
              icons={CALLOUT_ICONS}
              calloutType={calloutType}
              iconColor={config.iconColor}
              pickedIcon={pickedIcon}
              dismissible={dismissible}
              title={title}
              collapsible={collapsible}
              startsOpen={startsOpen}
              tone={tone}
              onTypeChange={handleTypeChange}
            />
          )}
        </div>

        {/* Content (with the optional title, which can fold it for learners) */}
        <div className="grow min-w-0">
          {title && (
            <div contentEditable={false} className="mt-[1px] mb-1 font-semibold leading-snug">
              {collapsible && !isEditable ? (
                <button
                  type="button"
                  aria-expanded={learnerOpen}
                  aria-controls={bodyId}
                  onClick={() => setLearnerOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-black/20 rounded-md"
                >
                  <span className="min-w-0 break-words">{title}</span>
                  <CaretDown size={14} weight="bold" className={`shrink-0 opacity-60 transition-transform motion-reduce:transition-none ${learnerOpen ? 'rotate-180' : ''}`} />
                </button>
              ) : (
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words">{title}</span>
                  {collapsible && <CaretDown size={14} weight="bold" className="shrink-0 opacity-40" aria-hidden />}
                </span>
              )}
            </div>
          )}
          <div id={bodyId} className={bodyOpen ? undefined : 'hidden'}>
            <NodeViewContent className="content" />
          </div>
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
