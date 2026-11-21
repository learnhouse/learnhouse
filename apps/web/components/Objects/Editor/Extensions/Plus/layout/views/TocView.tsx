'use client'
/*
 Table of contents (atom): lists the lesson's headings and links to their
 anchors. In an editor (authoring, DynamicCanva) it reads the live document
 with the same ids CustomHeading writes; in a static render (StaticCanva,
 @learnhouse/react) it reads the rendered headings once mounted.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ListBullets, SlidersHorizontal } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { computeHeadingIds } from '@components/Objects/Activities/DynamicCanva/headingIds'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, Segmented, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import { TOC_LEVELS, oneOf, outlineEntries, type OutlineHeading } from '../layoutModel'
import { commitAttrs, hasLiveDoc, prefersReducedMotion, SwitchRow } from '../shared'
import { headingsFromDom } from '../tocDom'

function useHeadings(editor: NodeViewProps['editor'], rootRef: React.RefObject<HTMLElement | null>): OutlineHeading[] {
  const live = hasLiveDoc(editor)
  const read = React.useCallback(() => (live ? computeHeadingIds(editor.state.doc) : []), [editor, live])
  const [headings, setHeadings] = React.useState<OutlineHeading[]>(read)
  React.useEffect(() => {
    if (live) {
      const update = () => setHeadings(read())
      update()
      editor.on('update', update)
      return () => {
        editor.off('update', update)
      }
    }
    // Static render: the headings are in the page by now (blocks above may
    // still be loading their code, so look again on the next frame too).
    const scan = () => {
      const scope = rootRef.current?.closest('.ProseMirror') ?? document
      setHeadings(headingsFromDom(scope))
    }
    scan()
    const raf = requestAnimationFrame(scan)
    return () => cancelAnimationFrame(raf)
  }, [editor, live, read, rootRef])
  return headings
}

export default function TocView(props: NodeViewProps) {
  const { t } = useTranslation()
  const isEditable = !!(useEditorProvider() as any)?.isEditable
  const { node, editor } = props
  const rootRef = React.useRef<HTMLDivElement>(null)
  const headings = useHeadings(editor, rootRef)
  const maxLevel = oneOf(TOC_LEVELS, Number(node.attrs.maxLevel), 3)
  const numbered = !!node.attrs.numbered
  const entries = outlineEntries(headings, maxLevel)
  const title: string = typeof node.attrs.title === 'string' ? node.attrs.title : ''
  const fallbackTitle = t('activities.table_of_contents.title', 'Contents')
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(title)
  const typing = React.useRef(false)
  React.useEffect(() => {
    if (!typing.current) setDraft(title)
  }, [title])

  const go = (e: React.MouseEvent, entry: (typeof entries)[number]) => {
    e.preventDefault()
    const behavior: 'auto' | 'smooth' = prefersReducedMotion() ? 'auto' : 'smooth'
    let target: Element | null = null
    if (isEditable && typeof entry.pos === 'number' && hasLiveDoc(editor)) {
      target = editor.view.nodeDOM(entry.pos) as Element | null
    } else {
      target = document.getElementById(entry.id)
      try {
        history.replaceState(history.state, '', `#${entry.id}`)
      } catch {
        // Sandboxed embeds may refuse; scrolling still works.
      }
    }
    target?.scrollIntoView?.({ behavior, block: 'start' })
  }

  const tools = (
    <BlockPopover
      open={open}
      onOpenChange={setOpen}
      title={t('editor.blocks_v2.table_of_contents.label', 'Table of contents')}
      trigger={
        <BlockToolbarButton label={t('editor.blocks_v2.layout.settings', 'Settings')} active={open}>
          <SlidersHorizontal size={14} />
        </BlockToolbarButton>
      }
    >
      <SettingsField label={t('editor.blocks_v2.table_of_contents.depth', 'Headings to include')}>
        <Segmented
          ariaLabel={t('editor.blocks_v2.table_of_contents.depth', 'Headings to include')}
          value={String(maxLevel) as '2' | '3' | '4'}
          onChange={(v) => commitAttrs(props, { maxLevel: Number(v) })}
          options={[
            { value: '2', label: 'H1–H2' },
            { value: '3', label: 'H1–H3' },
            { value: '4', label: 'H1–H4' },
          ]}
        />
      </SettingsField>
      <SwitchRow label={t('editor.blocks_v2.table_of_contents.numbered', 'Number the entries')} checked={numbered} onChange={(v) => commitAttrs(props, { numbered: v })} />
    </BlockPopover>
  )

  if (!isEditable && entries.length === 0) {
    return <NodeViewWrapper ref={rootRef} className="lh-toc" data-empty="" />
  }

  return (
    <NodeViewWrapper ref={rootRef} className="lh-toc lh-layout my-4">
      <EditorBlockFrame
        editable={isEditable}
        node={node}
        editor={editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="neutral"
        label={t('editor.blocks_v2.table_of_contents.label', 'Table of contents')}
        tools={tools}
        forceToolbar={open}
      >
        <nav aria-label={title || fallbackTitle} className="rounded-2xl bg-neutral-50 px-5 py-4 ring-1 ring-inset ring-neutral-200/70">
          <div className="mb-2 flex items-center gap-2 text-neutral-500">
            <ListBullets size={15} weight="bold" aria-hidden />
            {isEditable ? (
              <input
                value={draft}
                placeholder={fallbackTitle}
                aria-label={t('editor.blocks_v2.table_of_contents.title_label', 'Title')}
                onFocus={() => (typing.current = true)}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  typing.current = false
                  if (draft !== title) commitAttrs(props, { title: draft.slice(0, 120) })
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault()
                    if (e.key === 'Escape') setDraft(title)
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold uppercase tracking-wide text-neutral-600 outline-none placeholder:text-neutral-400"
              />
            ) : (
              <p className="m-0 text-[13px] font-semibold uppercase tracking-wide">{title || fallbackTitle}</p>
            )}
          </div>
          {entries.length === 0 ? (
            <p className="m-0 text-[14px] text-neutral-400">{t('editor.blocks_v2.table_of_contents.empty', 'Add headings to the lesson and they will be listed here.')}</p>
          ) : (
            <ol className="lh-toc-list m-0 list-none p-0">
              {entries.map((entry) => (
                <li key={`${entry.id}-${entry.number}`} style={{ paddingInlineStart: `${entry.depth * 16}px` }}>
                  <a
                    href={`#${entry.id}`}
                    onClick={(e) => go(e, entry)}
                    className={cn(
                      'flex gap-2 rounded-md py-1 text-[15px] leading-snug text-neutral-700 no-underline outline-none transition-colors hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-sky-500/40',
                      entry.depth === 0 && 'font-medium',
                    )}
                  >
                    {numbered && <span className="flex-none tabular-nums text-neutral-400">{entry.number}</span>}
                    <span className="min-w-0">{entry.text}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </nav>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}
