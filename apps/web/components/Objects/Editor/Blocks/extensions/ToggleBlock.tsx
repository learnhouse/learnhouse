'use client'
/*
 Toggle (collapsible) block: a one-line summary with a caret, hiding any
 blocks under it until opened. Good for hints, worked solutions and "read
 more" sections.

 Stored as `toggleBlock` { summary, defaultOpen } with block content. Whether
 it is open in the editor is local UI state (not synced), so one author
 folding it never folds it for collaborators. Learners start collapsed unless
 the author ticks "Open by default".

 Editor Plus adds `variant` (default / bordered / filled) and `icon`
 (chevron / plus); null is the original look. The node name and content stay
 as they were: the accordion block is a group of these toggles.
*/
import React from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { CaretRight, Minus, Plus } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { cn } from '@/lib/utils'
import { lazyView } from '../../Extensions/Plus/lazyView'
import {
  TOGGLE_EXTRA_ATTRS,
  toggleIconOf,
  toggleVariantOf,
  type ToggleIcon,
  type ToggleVariant,
} from '../schema/blockAttrs'

// The authoring tools are editor UI: learners never load them.
const ToggleTools = lazyView<NodeViewProps & { variant: ToggleVariant; icon: ToggleIcon; defaultOpen: boolean }>('ToggleTools', () => import('./ToggleTools'))

/** Frame classes per variant; 'default' is exactly the original toggle. */
export function toggleFrameClass(variant: ToggleVariant, editable: boolean): string {
  switch (variant) {
    case 'bordered':
      return 'bg-transparent ring-1 ring-inset ring-black/[0.14]'
    case 'filled':
      return editable ? 'bg-neutral-100/80 ring-1 ring-inset ring-black/[0.03]' : 'bg-neutral-100'
    default:
      return editable ? 'bg-neutral-50/70 ring-1 ring-inset ring-black/[0.05]' : 'bg-neutral-50 ring-1 ring-inset ring-black/[0.04]'
  }
}

function ToggleIconGlyph({ icon, open }: { icon: ToggleIcon; open: boolean }) {
  if (icon === 'plus') return open ? <Minus size={14} weight="bold" /> : <Plus size={14} weight="bold" />
  return <CaretRight size={14} weight="bold" className={cn('transition-transform duration-150 motion-reduce:transition-none', open ? 'rotate-90' : 'rtl:rotate-180')} />
}

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
  const variant = toggleVariantOf(props.node.attrs)
  const icon = toggleIconOf(props.node.attrs)
  const [open, setOpen] = React.useState(isEditable ? true : defaultOpen)
  const [draft, setDraft] = React.useState(summary)
  // Follow the stored title (collaborators, undo) unless it is being typed in
  const typing = React.useRef(false)
  React.useEffect(() => {
    if (!typing.current) setDraft(summary)
  }, [summary])
  const bodyId = React.useId()

  const commit = () => {
    const next = draft.slice(0, 300)
    if (next !== summary) props.updateAttributes({ summary: next })
  }

  return (
    <NodeViewWrapper
      className={cn('lh-toggle my-3 rounded-xl', toggleFrameClass(variant, isEditable), props.selected && 'ring-2 ring-sky-500/40')}
      data-variant={variant === 'default' ? undefined : variant}
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
          <ToggleIconGlyph icon={icon} open={open} />
        </button>
        {isEditable ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => (typing.current = true)}
            onBlur={() => {
              typing.current = false
              commit()
            }}
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
        {isEditable && <ToggleTools {...props} variant={variant} icon={icon} defaultOpen={defaultOpen} />}
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
      ...TOGGLE_EXTRA_ATTRS,
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
    return lhNodeView(ToggleBlockView)
  },
})

export default ToggleBlock
