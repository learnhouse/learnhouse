'use client'
/*
 The callout's picker in the editor: type, icon, title, folding, dismissing
 and colour. Editor only, so it is a chunk of its own (CalloutComponent).
*/
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CALLOUT_TONES, type CalloutTone } from './calloutStyles'
import type { CalloutType } from './CalloutComponent'

const CALLOUT_EMOJIS = ['💡', '⚠️', '📌', '✅', '❗', '🔥', '📝', '🎯', '🚀', '🧠', '👉', '🎉']

type CalloutLook = { labelKey: string; Icon: React.ElementType; bg: string; text: string; iconColor: string; ring: string }

export interface CalloutPickerProps {
  pickerRef: React.RefObject<HTMLDivElement | null>
  node: any
  updateAttributes: (_attrs: Record<string, any>) => void
  types: Record<CalloutType, CalloutLook>
  icons: Record<string, React.ElementType>
  calloutType: CalloutType
  iconColor: string
  pickedIcon: string | null
  dismissible: boolean
  title: string
  collapsible: boolean
  startsOpen: boolean
  tone: CalloutTone | null
  onTypeChange: (_type: CalloutType) => void
}

export default function CalloutPicker({
  pickerRef,
  node,
  updateAttributes,
  types,
  icons,
  calloutType,
  iconColor,
  pickedIcon,
  dismissible,
  title,
  collapsible,
  startsOpen,
  tone,
  onTypeChange,
}: CalloutPickerProps) {
  const { t } = useTranslation()
  // null while not typing: the field shows the stored title (undo, collaborators).
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  return (
    <div
      ref={pickerRef}
      contentEditable={false}
      className="absolute top-8 start-0 z-50 bg-white rounded-xl shadow-lg ring-1 ring-black/10 py-1.5 w-[228px] max-h-[70vh] overflow-y-auto overscroll-contain"
    >
      {(Object.entries(types) as [CalloutType, typeof types[CalloutType]][]).map(
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
                onTypeChange(type)
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
      {node?.type?.name === 'callout' && (
        <>
          <div className="mx-3 my-1.5 h-px bg-gray-100" />
          <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {t('editor.blocks_v2.callout_icon', 'Icon')}
          </div>
          <div className="grid grid-cols-6 gap-0.5 px-2 pb-1">
            {Object.entries(icons).map(([key, PickIcon]) => (
              <button
                key={key}
                type="button"
                title={key}
                aria-label={key}
                aria-pressed={pickedIcon === key}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  updateAttributes({ icon: key })
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${pickedIcon === key ? 'bg-gray-900 text-white' : `${iconColor} hover:bg-gray-100`}`}
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
                  updateAttributes({ icon: emoji })
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
                updateAttributes({ icon: null })
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
              onChange={(e) => updateAttributes({ dismissible: e.target.checked })}
            />
          </label>
          <div className="mx-3 my-1.5 h-px bg-gray-100" />
          <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {t('editor.blocks_v2.callout_title', 'Title')}
          </div>
          <div className="px-2 pb-1" onMouseDown={(e) => e.stopPropagation()}>
            <input
              value={titleDraft ?? title}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const next = (titleDraft ?? title).trim().slice(0, 200)
                setTitleDraft(null)
                if (next !== title) updateAttributes({ title: next })
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
              placeholder={t('editor.blocks_v2.callout_title_placeholder', 'Optional title')}
              aria-label={t('editor.blocks_v2.callout_title', 'Title')}
              className="h-7 w-full rounded-md bg-gray-50 px-2 text-xs text-gray-800 outline-none ring-1 ring-inset ring-gray-200 placeholder:text-gray-400 focus:ring-2 focus:ring-sky-500/40"
            />
          </div>
          <label
            className={`mx-2 mb-1 flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs hover:bg-gray-50 ${title ? 'text-gray-600' : 'text-gray-300'}`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span>{t('editor.blocks_v2.callout_collapsible', 'Learners can fold it')}</span>
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-gray-900"
              disabled={!title}
              checked={collapsible}
              onChange={(e) => updateAttributes({ collapsible: e.target.checked })}
            />
          </label>
          {collapsible && (
            <label
              className="mx-2 mb-1 flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <span>{t('editor.blocks_v2.callout_default_open', 'Open at first')}</span>
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-gray-900"
                checked={startsOpen}
                onChange={(e) => updateAttributes({ defaultOpen: e.target.checked })}
              />
            </label>
          )}
          <div className="mx-3 my-1.5 h-px bg-gray-100" />
          <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {t('editor.blocks_v2.callout_tone', 'Colour')}
          </div>
          <div className="flex flex-wrap gap-1 px-2 pb-1.5">
            <button
              type="button"
              aria-pressed={!tone}
              title={t('editor.blocks_v2.callout_tone_default', 'The type’s colour')}
              aria-label={t('editor.blocks_v2.callout_tone_default', 'The type’s colour')}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                updateAttributes({ tone: null })
              }}
              className={`h-6 w-6 rounded-full ${types[calloutType].bg} ring-1 ring-inset ring-black/10 ${!tone ? 'outline outline-2 outline-offset-1 outline-gray-900' : ''}`}
            />
            {(Object.keys(CALLOUT_TONES) as CalloutTone[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={tone === key}
                title={t(`editor.blocks_v2.colors.${key}`, key)}
                aria-label={t(`editor.blocks_v2.colors.${key}`, key)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  updateAttributes({ tone: key })
                }}
                className={`h-6 w-6 rounded-full ${CALLOUT_TONES[key].swatch} ${tone === key ? 'outline outline-2 outline-offset-1 outline-gray-900' : ''}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
