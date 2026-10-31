'use client'
import React, { useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { Braces } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { VARIABLES, VARIABLE_FORMATS, variableDef } from './dynamicRules'

const GROUP_ORDER = ['user', 'course', 'progress', 'date'] as const

function DynamicVariableComponent({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = editorState?.isEditable ?? false
  // Settings show while the chip is selected (so right after insertion too),
  // until the author clicks away or toggles them off.
  const [closed, setClosed] = useState(false)
  const open = isEditable && selected && !closed
  const wrapperRef = useRef<HTMLSpanElement>(null)

  const { path, fallback, format } = node.attrs
  const def = variableDef(path)
  const label = def ? t(`editor.dynamic.variables.${path.replace('.', '_')}`, def.label) : path

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setClosed(true)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <NodeViewWrapper as="span" ref={wrapperRef} className="relative inline-block align-baseline">
      <span
        contentEditable={false}
        title={`{{${path}}}`}
        onMouseDown={(e) => {
          if (!isEditable) return
          e.preventDefault()
          if (selected) {
            setClosed(open)
            return
          }
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (pos !== undefined) editor.commands.setNodeSelection(pos)
          setClosed(false)
        }}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.9em] font-medium leading-none bg-violet-50 text-violet-700 ring-1 ring-inset ${
          selected && isEditable ? 'ring-violet-400' : 'ring-violet-200'
        } ${isEditable ? 'cursor-pointer hover:bg-violet-100' : ''}`}
      >
        <Braces size={12} className="opacity-70" />
        {label}
        {format && <span className="text-[0.75em] uppercase opacity-60">{format}</span>}
      </span>

      {open && (
        <span
          contentEditable={false}
          className="absolute start-0 top-full mt-1.5 z-50 block w-72 rounded-xl bg-white p-3 text-sm text-gray-700 shadow-lg ring-1 ring-black/10"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <label className="block text-xs font-semibold text-gray-500 mb-1">
            {t('editor.dynamic.variable', 'Variable')}
          </label>
          <select
            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
            value={path}
            onChange={(e) => updateAttributes({ path: e.target.value })}
          >
            {GROUP_ORDER.map((group) => (
              <optgroup key={group} label={t(`editor.dynamic.variable_groups.${group}`, group)}>
                {VARIABLES.filter((v) => v.group === group).map((v) => (
                  <option key={v.path} value={v.path}>
                    {t(`editor.dynamic.variables.${v.path.replace('.', '_')}`, v.label)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <label className="block text-xs font-semibold text-gray-500 mt-3 mb-1">
            {t('editor.dynamic.fallback', 'Fallback when empty')}
          </label>
          <input
            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
            value={fallback || ''}
            maxLength={200}
            placeholder={t('editor.dynamic.fallback_placeholder', 'e.g. there')}
            onChange={(e) => updateAttributes({ fallback: e.target.value })}
          />

          <label className="block text-xs font-semibold text-gray-500 mt-3 mb-1">
            {t('editor.dynamic.format', 'Format')}
          </label>
          <div className="flex flex-wrap gap-1">
            {[null, ...VARIABLE_FORMATS].map((f) => (
              <button
                key={f ?? 'none'}
                type="button"
                onClick={() => updateAttributes({ format: f })}
                className={`rounded-md px-2 py-1 text-xs ${
                  format === f ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t(`editor.dynamic.formats.${f ?? 'none'}`, f ?? 'As is')}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-400">
            {t('editor.dynamic.variable_hint', {
              example: '{{course.name}}',
              defaultValue: 'Each learner sees their own value. Tip: type {{example}} to insert one.',
            })}
          </p>
        </span>
      )}
    </NodeViewWrapper>
  )
}

export default DynamicVariableComponent
