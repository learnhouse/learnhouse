'use client'
/*
 Accordion: a group of the existing toggle blocks. The toggles keep their own
 view and state; the accordion only styles them as a set and, for learners,
 coordinates them through the DOM (toggles are separate node views, so there
 is no shared React state): one open at a time in single mode, expand or
 collapse all, and arrow keys between the toggle headers.
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowsInLineVertical, ArrowsOutLineVertical, Plus, SlidersHorizontal } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, Segmented, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import { ACCORDION_VARIANTS, oneOf } from '../layoutModel'
import { appendChild, commitAttrs, SwitchRow, useHydrated } from '../shared'

/** The accordion's own toggles (not those of a nested accordion or toggle). */
export function directToggles(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.node-toggleBlock')).filter(
    (el) => el.parentElement?.closest('.node-toggleBlock, [data-lh-accordion]') === root,
  )
}
const headerButton = (toggle: HTMLElement) => toggle.querySelector<HTMLButtonElement>('button[aria-expanded]')
export const isToggleOpen = (toggle: HTMLElement) => headerButton(toggle)?.getAttribute('aria-expanded') === 'true'

export default function AccordionView(props: NodeViewProps) {
  const { t } = useTranslation()
  const isEditable = !!(useEditorProvider() as any)?.isEditable
  const hydrated = useHydrated()
  const { node } = props
  const single = node.attrs.single !== false
  const variant = oneOf(ACCORDION_VARIANTS, node.attrs.variant, 'default')
  const rootRef = React.useRef<HTMLDivElement>(null)
  const busy = React.useRef(false)
  const [state, setState] = React.useState({ open: 0, total: node.childCount })
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  React.useEffect(() => {
    const root = rootRef.current
    if (isEditable || !root) return
    const count = () => {
      const toggles = directToggles(root)
      setState({ open: toggles.filter(isToggleOpen).length, total: toggles.length })
    }
    count()
    const observer = new MutationObserver(count)
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'], childList: true })

    const onClick = (e: MouseEvent) => {
      if (busy.current || !single) return
      const target = e.target as HTMLElement
      const toggles = directToggles(root)
      const clicked = toggles.find((tg) => headerButton(tg)?.parentElement?.contains(target))
      if (!clicked) return
      // Read the result once the toggle has re-rendered.
      setTimeout(() => {
        if (!isToggleOpen(clicked)) return
        busy.current = true
        for (const other of toggles) if (other !== clicked && isToggleOpen(other)) headerButton(other)?.click()
        busy.current = false
      }, 0)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const toggles = directToggles(root)
      const index = toggles.findIndex((tg) => {
        const header = headerButton(tg)?.parentElement
        return !!header && header.contains(e.target as Node)
      })
      if (index < 0) return
      const last = toggles.length - 1
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowDown' ? Math.min(last, index + 1) : Math.max(0, index - 1)
      e.preventDefault()
      headerButton(toggles[next])?.focus()
    }
    root.addEventListener('click', onClick)
    root.addEventListener('keydown', onKeyDown)
    return () => {
      observer.disconnect()
      root.removeEventListener('click', onClick)
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [isEditable, single])

  const setAll = (open: boolean) => {
    const root = rootRef.current
    if (!root) return
    busy.current = true
    for (const toggle of directToggles(root)) if (isToggleOpen(toggle) !== open) headerButton(toggle)?.click()
    busy.current = false
  }
  const allOpen = state.total > 0 && state.open === state.total

  const tools = (
    <>
      <BlockToolbarButton
        label={t('editor.blocks_v2.accordion.add', 'Add section')}
        onClick={() => appendChild(props, { type: 'toggleBlock', attrs: { summary: '' }, content: [{ type: 'paragraph' }] })}
      >
        <Plus size={14} />
      </BlockToolbarButton>
      <BlockPopover
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={t('editor.blocks_v2.accordion.label', 'Accordion')}
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
              { value: 'default', label: t('editor.blocks_v2.accordion.variant_default', 'Default') },
              { value: 'bordered', label: t('editor.blocks_v2.accordion.variant_bordered', 'Bordered') },
              { value: 'filled', label: t('editor.blocks_v2.accordion.variant_filled', 'Filled') },
            ]}
          />
        </SettingsField>
        <SwitchRow label={t('editor.blocks_v2.accordion.single', 'One section open at a time')} checked={single} onChange={(v) => commitAttrs(props, { single: v })} />
      </BlockPopover>
    </>
  )

  return (
    <NodeViewWrapper ref={rootRef} className="lh-accordion lh-layout my-4" data-lh-accordion="" data-variant={variant} data-single={single ? 'true' : 'false'}>
      <EditorBlockFrame
        editable={isEditable}
        node={node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="neutral"
        label={t('editor.blocks_v2.accordion.label', 'Accordion')}
        tools={tools}
        editableContent
        forceToolbar={settingsOpen}
      >
        {!isEditable && hydrated && state.total > 1 && (
          <div contentEditable={false} className="lh-accordion-actions flex justify-end">
            <button
              type="button"
              onClick={() => setAll(!allOpen)}
              aria-label={allOpen ? t('activities.accordion.collapse_all', 'Collapse all') : t('activities.accordion.expand_all', 'Expand all')}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-neutral-500 outline-none transition-colors hover:bg-black/5 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500/40"
            >
              {allOpen ? <ArrowsInLineVertical size={13} /> : <ArrowsOutLineVertical size={13} />}
              {allOpen ? t('activities.accordion.collapse_all', 'Collapse all') : t('activities.accordion.expand_all', 'Expand all')}
            </button>
          </div>
        )}
        <NodeViewContent className="lh-accordion-body" />
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}
