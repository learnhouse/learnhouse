'use client'
/*
 Toggle (collapsible) block: a one-line summary with a caret, hiding any
 blocks under it until opened. Good for hints, worked solutions and "read
 more" sections.

 Stored as `toggleBlock` { summary, defaultOpen } with block content. Whether
 it is open in the editor is local UI state (not synced), so one author
 folding it never folds it for collaborators. Learners start collapsed unless
 the author ticks "Open by default".
*/
import React from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { CaretRight, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { cn } from '@/lib/utils'
import { deleteBlock } from '../nodeViewUtils'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggleBlock: {
      insertToggleBlock: () => ReturnType
    }
  }
}

function ToggleBlockView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  const summary: string = props.node.attrs.summary || ''
  const defaultOpen = !!props.node.attrs.defaultOpen
  const [open, setOpen] = React.useState(isEditable ? true : defaultOpen)
  const [draft, setDraft] = React.useState(summary)
  React.useEffect(() => setDraft(summary), [summary])
  const bodyId = React.useId()

  const commit = () => {
    const next = draft.slice(0, 300)
    if (next !== summary) props.updateAttributes({ summary: next })
  }

  return (
    <NodeViewWrapper
      className={cn(
        'lh-toggle my-3 rounded-xl',
        isEditable ? 'bg-neutral-50/70 ring-1 ring-inset ring-black/[0.05]' : 'bg-neutral-50 ring-1 ring-inset ring-black/[0.04]',
        props.selected && 'ring-2 ring-sky-500/40',
      )}
    >
      <div contentEditable={false} className="group/toggle flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? t('editor.blocks_v2.collapse', 'Collapse') : t('editor.blocks_v2.expand', 'Expand')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-800"
        >
          <CaretRight size={14} weight="bold" className={cn('transition-transform duration-150', open ? 'rotate-90' : 'rtl:rotate-180')} />
        </button>
        {isEditable ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
                setOpen(true)
                ;(e.target as HTMLInputElement).blur()
                // Move the caret into the body so typing continues there.
                const pos = props.getPos()
                if (typeof pos === 'number') props.editor.chain().focus().setTextSelection(pos + 2).run()
              }
            }}
            placeholder={t('editor.blocks_v2.toggle_placeholder', 'Toggle title')}
            aria-label={t('editor.blocks_v2.toggle_title', 'Toggle title')}
            className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-neutral-800 outline-none placeholder:text-neutral-400"
          />
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="min-w-0 flex-1 text-start text-[15px] font-semibold text-neutral-800"
          >
            {summary || t('editor.blocks_v2.toggle_untitled', 'Details')}
          </button>
        )}
        {isEditable && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/toggle:opacity-100 focus-within:opacity-100">
            <label className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-neutral-500 hover:bg-black/5">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-neutral-900"
                checked={defaultOpen}
                onChange={(e) => props.updateAttributes({ defaultOpen: e.target.checked })}
              />
              {t('editor.blocks_v2.toggle_open_default', 'Open by default')}
            </label>
            <button
              type="button"
              aria-label={t('common.delete', 'Delete')}
              title={t('common.delete', 'Delete')}
              onClick={() => deleteBlock(props)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
            >
              <Trash size={13} />
            </button>
          </div>
        )}
      </div>
      <div id={bodyId} className={cn('lh-toggle-body ps-10 pe-4 pb-3', !open && 'hidden')}>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  )
}

export const ToggleBlock = Node.create({
  name: 'toggleBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      summary: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-summary') || el.querySelector('summary')?.textContent || '',
        renderHTML: (attrs: Record<string, any>) => (attrs.summary ? { 'data-summary': attrs.summary } : {}),
      },
      defaultOpen: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-open') === 'true' || el.hasAttribute('open'),
        renderHTML: (attrs: Record<string, any>) => (attrs.defaultOpen ? { 'data-open': 'true' } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-block' }), 0]
  },

  addCommands() {
    return {
      insertToggleBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { summary: '' }, content: [{ type: 'paragraph' }] }),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleBlockView)
  },
})

export default ToggleBlock
