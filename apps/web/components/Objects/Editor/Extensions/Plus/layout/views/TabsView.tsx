'use client'
/*
 Tabs: a tab bar over `tabItem` panels that hold ordinary blocks.

 Which tab is open is local UI state (never synced). Panels are shown and
 hidden with CSS (layout.css), so the document markup is the same in the
 editor, DynamicCanva and StaticCanva. Before hydration (server HTML, no JS)
 and in print every panel shows, stacked under its title.
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { CaretLeft, CaretRight, MinusCircle, Plus, SlidersHorizontal } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, Segmented, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import { MAX_TABS, MIN_TABS, TAB_VARIANTS, moveItem, oneOf, type TabVariant } from '../layoutModel'
import { appendChild, childPos, childrenJSON, commitAttrs, hasLiveDoc, isRtl, liveNode, removeChild, replaceChildren, setChildAttrs, useHydrated } from '../shared'

function titlesOf(node: NodeViewProps['node']): string[] {
  const out: string[] = []
  node.forEach((child) => out.push(typeof child.attrs.title === 'string' ? child.attrs.title : ''))
  return out
}

const TAB_CLASSES: Record<TabVariant, { bar: string; tab: string; active: string; idle: string; panels: string }> = {
  line: {
    bar: 'gap-1 shadow-[inset_0_-1px_0_var(--lhb-border,rgba(0,0,0,0.08))]',
    tab: 'rounded-t-lg px-3 py-2 border-b-2',
    active: 'border-neutral-900 text-neutral-900',
    idle: 'border-transparent text-neutral-500 hover:text-neutral-800',
    panels: 'pt-3',
  },
  pills: {
    bar: 'gap-1.5',
    tab: 'rounded-full px-3.5 py-1.5',
    active: 'bg-neutral-900 text-white',
    idle: 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200/80 hover:text-neutral-900',
    panels: 'pt-3',
  },
  boxed: {
    bar: 'gap-0.5 rounded-t-xl bg-neutral-100 p-1',
    tab: 'rounded-lg px-3 py-1.5',
    active: 'bg-white text-neutral-900 shadow-[0_1px_1px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]',
    idle: 'text-neutral-500 hover:text-neutral-900',
    panels: 'rounded-b-xl px-4 pb-1 pt-2 ring-1 ring-inset ring-neutral-200/80',
  },
}

export default function TabsView(props: NodeViewProps) {
  const { t } = useTranslation()
  const isEditable = !!(useEditorProvider() as any)?.isEditable
  const hydrated = useHydrated()
  const { node, editor } = props
  const titles = titlesOf(node)
  const count = titles.length
  const variant = oneOf(TAB_VARIANTS, node.attrs.variant, 'line')
  const [rawActive, setActive] = React.useState(0)
  const active = Math.min(rawActive, Math.max(count - 1, 0))
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const barRef = React.useRef<HTMLDivElement>(null)
  const baseId = React.useId()
  const classes = TAB_CLASSES[variant]
  const tabLabel = (i: number) => titles[i]?.trim() || t('activities.tabs.untitled', 'Tab {{n}}', { n: i + 1 })

  // In the editor, follow the caret: moving it into a hidden panel (arrow
  // keys, search, undo) opens that panel.
  const propsRef = React.useRef(props)
  React.useEffect(() => {
    propsRef.current = props
  })
  React.useEffect(() => {
    if (!isEditable || !hasLiveDoc(editor)) return
    const onSelection = () => {
      const live = liveNode(propsRef.current)
      if (!live) return
      const { from } = editor.state.selection
      const start = live.pos + 1
      if (from < start || from > live.pos + live.node.nodeSize - 1) return
      let offset = start
      live.node.forEach((child, _o, index) => {
        if (from >= offset && from <= offset + child.nodeSize) setActive(index)
        offset += child.nodeSize
      })
    }
    editor.on('selectionUpdate', onSelection)
    return () => {
      editor.off('selectionUpdate', onSelection)
    }
  }, [editor, isEditable])

  /** Put the caret at the start of a panel so typing never lands in a hidden one. */
  const caretInto = (index: number) => {
    const live = liveNode(props)
    if (!live) return
    const offset = childPos(live.pos, live.node, index)
    const { state } = editor
    const sel = TextSelection.near(state.doc.resolve(Math.min(offset + 1, state.doc.content.size)))
    editor.view.dispatch(state.tr.setSelection(sel))
  }

  const select = (index: number, focus = false) => {
    setActive(index)
    if (isEditable) caretInto(index)
    if (focus) barRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus()
  }

  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const rtl = isRtl(barRef.current)
    const next = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key as 'ArrowRight' | 'ArrowLeft']
    let target: number | null = null
    if (next) target = (index + next + count) % count
    if (e.key === 'Home') target = 0
    if (e.key === 'End') target = count - 1
    if (target === null) return
    e.preventDefault()
    e.stopPropagation()
    select(target, true)
  }

  // ── Editing (all read the live node) ─────────────────────────────────────
  const rename = (index: number, title: string) => setChildAttrs(props, index, { title: title.slice(0, 120) })
  const addTab = () => {
    if (count >= MAX_TABS) return
    if (appendChild(props, { type: 'tabItem', attrs: { title: '' }, content: [{ type: 'paragraph' }] })) select(count)
  }
  const removeTab = () => {
    if (removeChild(props, active, MIN_TABS)) select(Math.max(0, active - 1))
  }
  const moveTab = (dir: -1 | 1) => {
    const live = liveNode(props)
    const to = active + dir
    if (!live || to < 0 || to >= live.node.childCount) return
    if (replaceChildren(props, moveItem(childrenJSON(live.node), active, to))) select(to)
  }

  const bar = hydrated ? (
    <div
      ref={barRef}
      role="tablist"
      aria-label={t('activities.tabs.list_label', 'Tabs')}
      contentEditable={false}
      className={cn('lh-tabs-bar flex items-end overflow-x-auto scrollbar-hide', classes.bar)}
    >
      {titles.map((_title, i) => {
        const selected = i === active
        const shared = cn(
          'lh-tabs-tab flex-none whitespace-nowrap text-[14px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40',
          classes.tab,
          selected ? classes.active : classes.idle,
        )
        if (isEditable && selected) {
          return (
            <TabTitleInput
              key={i}
              id={`${baseId}-tab-${i}`}
              value={titles[i]}
              placeholder={tabLabel(i)}
              ariaLabel={t('editor.blocks_v2.tabs.title_placeholder', 'Tab title')}
              className={shared}
              onCommit={(v) => rename(i, v)}
            />
          )
        }
        return (
          <button
            key={i}
            id={`${baseId}-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onMouseDown={(e) => isEditable && e.preventDefault()}
            onClick={() => select(i)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={shared}
          >
            {tabLabel(i)}
          </button>
        )
      })}
      {isEditable && count < MAX_TABS && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addTab}
          aria-label={t('editor.blocks_v2.tabs.add', 'Add tab')}
          title={t('editor.blocks_v2.tabs.add', 'Add tab')}
          className="mb-1 ms-1 flex h-7 w-7 flex-none items-center justify-center rounded-md text-neutral-400 hover:bg-black/5 hover:text-neutral-800"
        >
          <Plus size={14} weight="bold" />
        </button>
      )}
    </div>
  ) : null

  const tools = (
    <>
      <BlockToolbarButton label={t('editor.blocks_v2.tabs.move_earlier', 'Move tab earlier')} disabled={active === 0} onClick={() => moveTab(-1)}>
        <CaretLeft size={14} className="rtl:rotate-180" />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks_v2.tabs.move_later', 'Move tab later')} disabled={active >= count - 1} onClick={() => moveTab(1)}>
        <CaretRight size={14} className="rtl:rotate-180" />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks_v2.tabs.remove', 'Delete this tab')} disabled={count <= MIN_TABS} onClick={removeTab}>
        <MinusCircle size={14} />
      </BlockToolbarButton>
      <BlockPopover
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={t('editor.blocks_v2.tabs.label', 'Tabs')}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.layout.settings', 'Settings')} active={settingsOpen}>
            <SlidersHorizontal size={14} />
          </BlockToolbarButton>
        }
      >
        <SettingsField label={t('editor.blocks_v2.layout.style', 'Style')}>
          <Segmented
            ariaLabel={t('editor.blocks_v2.layout.style', 'Style')}
            value={variant}
            onChange={(v) => commitAttrs(props, { variant: v })}
            options={[
              { value: 'line', label: t('editor.blocks_v2.tabs.variant_line', 'Line') },
              { value: 'pills', label: t('editor.blocks_v2.tabs.variant_pills', 'Pills') },
              { value: 'boxed', label: t('editor.blocks_v2.tabs.variant_boxed', 'Boxed') },
            ]}
          />
        </SettingsField>
      </BlockPopover>
    </>
  )

  return (
    <NodeViewWrapper className="lh-tabs lh-layout my-4" data-variant={variant} data-ready={hydrated ? '' : undefined}>
      <EditorBlockFrame
        editable={isEditable}
        node={node}
        editor={editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="neutral"
        label={t('editor.blocks_v2.tabs.label', 'Tabs')}
        tools={tools}
        editableContent
        forceToolbar={settingsOpen}
      >
        {bar}
        <div className={cn('lh-tabs-panels', hydrated && classes.panels)} data-active={hydrated ? active : undefined}>
          <NodeViewContent className="lh-tabs-content" />
        </div>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

/** The open tab's title in the editor: typed in place, committed on blur / Enter. */
function TabTitleInput({ id, value, placeholder, ariaLabel, className, onCommit }: { id: string; value: string; placeholder: string; ariaLabel: string; className: string; onCommit: (_v: string) => void }) {
  const [draft, setDraft] = React.useState(value)
  const typing = React.useRef(false)
  React.useEffect(() => {
    if (!typing.current) setDraft(value)
  }, [value])
  const commit = () => {
    typing.current = false
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      id={id}
      role="tab"
      aria-selected
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      size={Math.max(4, Math.min(28, (draft || placeholder).length + 1))}
      onFocus={() => (typing.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          if (e.key === 'Escape') setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className={cn(className, 'min-w-0 bg-transparent placeholder:text-neutral-400')}
    />
  )
}

/** One panel. Its title is only shown in the no-JS / print form (CSS). */
export function TabItemView(props: NodeViewProps) {
  const { t } = useTranslation()
  const hydrated = useHydrated()
  const title = typeof props.node.attrs.title === 'string' ? props.node.attrs.title.trim() : ''
  return (
    <NodeViewWrapper className="lh-tab-panel" role={hydrated ? 'tabpanel' : undefined} aria-label={title || undefined}>
      <h3 className="lh-tab-title" contentEditable={false}>
        {title || t('activities.tabs.tab', 'Tab')}
      </h3>
      <NodeViewContent className="lh-tab-body" />
    </NodeViewWrapper>
  )
}
