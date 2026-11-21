'use client'
/*
 Stat highlights: a row of big numbers with a label and a short line each.
 For learners the numbers count up once, when the block scrolls into view;
 with reduced motion (or the author's switch off) they simply show. Screen
 readers always get the final value.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ChartBar, Plus, SlidersHorizontal, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, Segmented, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import { MAX_STATS, MIN_STATS, newId, normalizeStats, oneOf, STAT_COLUMNS, STAT_COUNT_MS, STAT_TONES, statFrame, type StatItem, type StatTone } from '../mediaModel'
import { commitAttrs, InlineInput, STAT_TONE_CLASSES, SwitchRow, useIsEditable, useReducedMotion } from './shared'

const GRID: Record<number, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
}

/** 0 → 1 once the element is first seen (1 right away when not animating). */
function useCountUp(enabled: boolean): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const canObserve = typeof window !== 'undefined' && typeof IntersectionObserver !== 'undefined'
  const active = enabled && canObserve
  const [counted, setProgress] = React.useState(active ? 0 : 1)
  const done = React.useRef(!active)
  React.useEffect(() => {
    if (!active || done.current) return
    const el = ref.current
    if (!el) return
    let raf = 0
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || done.current) return
        done.current = true
        io.disconnect()
        const t0 = performance.now()
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / STAT_COUNT_MS)
          setProgress(p)
          if (p < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [active])
  // Switched off (reduced motion, the author's setting, the editor): final numbers.
  return [ref, active ? counted : 1]
}

export default function StatHighlightsView(props: NodeViewProps) {
  const { t, i18n } = useTranslation()
  const isEditable = useIsEditable()
  const reduced = useReducedMotion()
  const { node } = props
  const items = React.useMemo(() => normalizeStats(node.attrs.items), [node.attrs.items])
  const columns = oneOf(STAT_COLUMNS, node.attrs.columns, 3)
  const animate = node.attrs.animate !== false
  const [ref, progress] = useCountUp(animate && !reduced && !isEditable)
  const [open, setOpen] = React.useState(false)
  const [itemMenu, setItemMenu] = React.useState<string | null>(null)

  const setItems = (fn: (_list: StatItem[]) => StatItem[]) => commitAttrs(props, (live) => ({ items: fn(normalizeStats(live.items)) }))
  const patchItem = (id: string, patch: Partial<StatItem>) =>
    setItems((list) =>
      list.map((s) => {
        if (s.id !== id) return s
        const next: any = { ...s, ...patch }
        for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k]
        return { ...next, value: next.value ?? '', label: next.label ?? '' }
      }),
    )
  const toneLabel = (tone: StatTone) => t(`editor.blocks_v2.layout.tone_${tone}`, tone)

  const tools = (
    <>
      <BlockToolbarButton
        label={t('editor.blocks_v2.stat_highlights.add', 'Add stat')}
        disabled={items.length >= MAX_STATS}
        onClick={() => setItems((list) => (list.length >= MAX_STATS ? list : [...list, { id: newId('stat'), value: '0', label: '' }]))}
      >
        <Plus size={14} />
      </BlockToolbarButton>
      <BlockPopover
        open={open}
        onOpenChange={setOpen}
        title={t('editor.blocks_v2.stat_highlights.label', 'Stats')}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.stat_highlights.settings', 'Stat settings')} active={open}>
            <SlidersHorizontal size={14} />
          </BlockToolbarButton>
        }
      >
        <SettingsField label={t('editor.blocks_v2.stat_highlights.columns', 'Columns')}>
          <Segmented ariaLabel={t('editor.blocks_v2.stat_highlights.columns', 'Columns')} value={String(columns) as '2' | '3' | '4'} onChange={(v) => commitAttrs(props, { columns: Number(v) })} options={[{ value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]} />
        </SettingsField>
        <SwitchRow label={t('editor.blocks_v2.stat_highlights.animate', 'Count up when shown')} checked={animate} onChange={(v) => commitAttrs(props, { animate: v })} />
      </BlockPopover>
    </>
  )

  const card = (s: StatItem) => {
    const tone = STAT_TONE_CLASSES[s.tone ?? 'neutral'] ?? STAT_TONE_CLASSES.neutral
    const full = `${s.prefix ?? ''}${s.value}${s.suffix ?? ''}`
    if (!isEditable) {
      const shown = statFrame(s.value, progress, i18n.language)
      return (
        <div key={s.id} className={cn('lh-stat flex min-w-0 flex-col gap-1 rounded-2xl px-5 py-4 ring-1 ring-inset', tone.card)} data-tone={s.tone ?? 'neutral'}>
          <dt className="order-2 mt-1 text-[14px] font-semibold text-neutral-800">{s.label}</dt>
          <dd className={cn('m-0 order-1 text-[32px] font-semibold leading-none tracking-tight tabular-nums sm:text-[36px]', tone.value)}>
            <span className="sr-only">{full}</span>
            <span aria-hidden>
              {s.prefix}
              {shown}
              {s.suffix}
            </span>
          </dd>
          {s.description && <dd className="order-3 m-0 text-[13px] leading-snug text-neutral-500">{s.description}</dd>}
        </div>
      )
    }
    const field = 'w-full min-w-0 bg-transparent outline-none placeholder:text-neutral-400'
    return (
      <div key={s.id} className={cn('group/stat relative flex min-w-0 flex-col gap-1 rounded-2xl px-4 py-3.5 ring-1 ring-inset', tone.card)}>
        <div className={cn('flex items-baseline gap-0.5 text-[30px] font-semibold leading-none tracking-tight tabular-nums', tone.value)}>
          <InlineInput value={s.prefix ?? ''} maxLength={8} onCommit={(v) => patchItem(s.id, { prefix: v.trim() || undefined })} placeholder="" aria-label={t('editor.blocks_v2.stat_highlights.prefix', 'Before the number')} className={cn(field, 'w-auto text-end')} size={Math.max(1, (s.prefix ?? '').length)} />
          <InlineInput value={s.value} maxLength={24} onCommit={(v) => patchItem(s.id, { value: v.trim() })} placeholder="0" aria-label={t('editor.blocks_v2.stat_highlights.value', 'Number')} className={cn(field, 'w-auto')} size={Math.max(2, s.value.length)} />
          <InlineInput value={s.suffix ?? ''} maxLength={12} onCommit={(v) => patchItem(s.id, { suffix: v.trim() || undefined })} placeholder="%" aria-label={t('editor.blocks_v2.stat_highlights.suffix', 'After the number')} className={cn(field, 'w-auto text-[20px] placeholder:opacity-50')} size={Math.max(2, (s.suffix ?? '').length)} />
        </div>
        <InlineInput value={s.label} maxLength={120} onCommit={(v) => patchItem(s.id, { label: v.trim() })} placeholder={t('editor.blocks_v2.stat_highlights.label_field', 'Label')} aria-label={t('editor.blocks_v2.stat_highlights.label_field', 'Label')} className={cn(field, 'mt-1 text-[14px] font-semibold text-neutral-800')} />
        <InlineInput value={s.description ?? ''} maxLength={300} onCommit={(v) => patchItem(s.id, { description: v.trim() || undefined })} placeholder={t('editor.blocks_v2.stat_highlights.description_placeholder', 'Short description (optional)')} aria-label={t('editor.blocks_v2.stat_highlights.description', 'Description')} className={cn(field, 'text-[13px] text-neutral-500')} />
        <div className="absolute end-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/stat:opacity-100">
          <BlockPopover
            open={itemMenu === s.id}
            onOpenChange={(o) => setItemMenu(o ? s.id : null)}
            title={t('editor.blocks_v2.stat_highlights.color', 'Color')}
            width={232}
            trigger={
              <button type="button" aria-label={t('editor.blocks_v2.stat_highlights.color', 'Color')} className="flex h-6 w-6 items-center justify-center rounded-md bg-white/80 shadow-sm ring-1 ring-black/5 hover:bg-white">
                <span className={cn('h-3 w-3 rounded-full', tone.dot)} />
              </button>
            }
          >
            <div role="radiogroup" aria-label={t('editor.blocks_v2.stat_highlights.color', 'Color')} className="flex flex-wrap gap-1.5">
              {STAT_TONES.map((tn) => (
                <button
                  key={tn}
                  type="button"
                  role="radio"
                  aria-checked={(s.tone ?? 'neutral') === tn}
                  aria-label={toneLabel(tn)}
                  title={toneLabel(tn)}
                  onClick={() => patchItem(s.id, { tone: tn === 'neutral' ? undefined : tn })}
                  className={cn('h-6 w-6 rounded-full outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-sky-500/50', STAT_TONE_CLASSES[tn].dot, (s.tone ?? 'neutral') === tn ? 'ring-2 ring-neutral-900/70' : '')}
                />
              ))}
            </div>
          </BlockPopover>
          <button
            type="button"
            disabled={items.length <= MIN_STATS}
            onClick={() => setItems((list) => (list.length <= MIN_STATS ? list : list.filter((x) => x.id !== s.id)))}
            aria-label={t('editor.blocks_v2.stat_highlights.remove', 'Remove stat')}
            className="flex h-6 w-6 items-center justify-center rounded-md bg-white/80 text-neutral-500 shadow-sm ring-1 ring-black/5 hover:bg-white hover:text-rose-600 disabled:opacity-40"
          >
            <Trash size={12} />
          </button>
        </div>
      </div>
    )
  }

  const Grid = isEditable ? 'div' : 'dl'
  return (
    <NodeViewWrapper className="lh-stat-highlights my-5" data-columns={columns}>
      <EditorBlockFrame
        editable={isEditable}
        node={node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="info"
        label={
          <>
            <ChartBar size={11} weight="bold" />
            {t('editor.blocks_v2.stat_highlights.label', 'Stats')}
          </>
        }
        tools={tools}
        forceToolbar={open || !!itemMenu}
      >
        <div ref={ref}>
          {items.length ? (
            <Grid className={cn('m-0 grid gap-3', GRID[columns])}>{items.map(card)}</Grid>
          ) : isEditable ? (
            <p className="m-0 rounded-2xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">{t('editor.blocks_v2.stat_highlights.empty', 'Add a stat to get started.')}</p>
          ) : null}
        </div>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}
