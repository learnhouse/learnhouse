'use client'
import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import { NodeViewContent, NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { EyeOff, FlipHorizontal2, SlidersHorizontal, Split, Ungroup } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { DEFAULT_RULES, RuleGroup, describeRules, negateRules } from './dynamicRules'
import { useDynamicLookups } from './useDynamicLookups'

const RuleBuilderModal = dynamic(() => import('./RuleBuilder'), { ssr: false })

function ConditionalBlockComponent({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = editorState?.isEditable ?? false
  const [showBuilder, setShowBuilder] = useState(false)
  const lookups = useDynamicLookups()

  const rules: RuleGroup = node.attrs.rules ?? DEFAULT_RULES
  const label: string = node.attrs.label ?? ''
  const summary = describeRules(rules, lookups.names)

  const position = () => (typeof getPos === 'function' ? getPos() : undefined)

  const unwrap = () => {
    const pos = position()
    if (pos === undefined) return
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.replaceWith(pos, pos + node.nodeSize, node.content)
        return true
      })
      .run()
  }

  const addOpposite = () => {
    const pos = position()
    if (pos === undefined) return
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize, {
        type: 'conditionalBlock',
        attrs: {
          rules: negateRules(rules),
          label: label ? t('editor.dynamic.opposite_label', { label, defaultValue: '{{label}} (otherwise)' }) : '',
        },
        content: [{ type: 'paragraph' }],
      })
      .run()
  }

  // Course editors reading the learner page get the raw document: show what
  // the block is for, but don't get in the way of reading it.
  if (!isEditable) {
    return (
      <NodeViewWrapper className="my-3 rounded-xl border border-dashed border-violet-300 px-3 pt-1 pb-0.5">
        <div
          contentEditable={false}
          className="-mt-3 mb-1 inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2 text-[11px] font-medium text-violet-600"
          title={summary}
        >
          <Split size={11} />
          <span className="truncate">
            {t('editor.dynamic.visible_to', 'Visible to')}: {summary}
          </span>
        </div>
        <NodeViewContent className="content" />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="my-4 rounded-xl ring-1 ring-violet-200 bg-violet-50/30">
      <div
        contentEditable={false}
        className="flex items-center gap-2 rounded-t-xl border-b border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-800"
      >
        {rules.negate ? <EyeOff size={14} className="shrink-0" /> : <Split size={14} className="shrink-0" />}
        <button
          type="button"
          onClick={() => setShowBuilder(true)}
          className="min-w-0 flex-1 truncate text-start hover:underline"
          title={summary}
        >
          <span className="font-semibold">{label || t('editor.dynamic.conditional_block', 'Conditional content')}</span>
          <span className="opacity-70">
            {' · '}
            {t('editor.dynamic.visible_to', 'Visible to')}: {summary}
          </span>
        </button>
        <HeaderButton title={t('editor.dynamic.edit_rules', 'Edit rules')} onClick={() => setShowBuilder(true)}>
          <SlidersHorizontal size={14} />
        </HeaderButton>
        <HeaderButton title={t('editor.dynamic.add_opposite', 'Add a block for everyone else')} onClick={addOpposite}>
          <FlipHorizontal2 size={14} />
        </HeaderButton>
        <HeaderButton title={t('editor.dynamic.unwrap', 'Show to everyone (remove condition)')} onClick={unwrap}>
          <Ungroup size={14} />
        </HeaderButton>
      </div>
      <div className="px-3 py-1">
        <NodeViewContent className="content" />
      </div>

      {showBuilder && (
        <RuleBuilderModal
          rules={rules}
          label={label}
          lookups={lookups}
          onClose={() => setShowBuilder(false)}
          onSave={(next, nextLabel) => {
            updateAttributes({ rules: next, label: nextLabel })
            setShowBuilder(false)
          }}
        />
      )}
    </NodeViewWrapper>
  )
}

function HeaderButton(props: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
      className="shrink-0 rounded-md p-1 text-violet-600 hover:bg-violet-100"
    >
      {props.children}
    </button>
  )
}

export default ConditionalBlockComponent
