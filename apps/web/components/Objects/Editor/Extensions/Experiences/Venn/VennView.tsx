'use client'
/*
 "Venn compare" (node expVenn): learners place fact chips in two overlapping
 circles (only A, both, only B), plus an outside well when the author turns
 "Neither" on.

 Author: edit in place on the learner's diagram, every item already in its
 correct region (the answer key). Group names and items are edited where
 they sit; items move by drag or tap-then-place; "+ Add item" per region;
 "Why?" opens an item's explanation. "Neither" lives behind the gear.

 Learner: chips in a tray; drag one onto a region (mouse, pen, touch
 press-and-hold) or tap a chip, then tap a region. Keyboard: Tab to a chip,
 Enter / Space selects it, 1–4 drop it straight into a zone, arrow keys move
 between chips, Escape clears. "Check" marks every chip ✓ / ✗ and the
 overlap glows when everything that belongs to both is in it. On narrow
 screens the circles become three stacked wells, each with a tiny Venn glyph.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowCounterClockwise, DotsSixVertical, Intersect, Tray } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  AddGhost,
  AnswerKeyHint,
  EDIT_OBJECT,
  ExperienceFooter,
  ExperienceFrame,
  InlineText,
  RemoveX,
  SettingsGear,
  SettingsToggle,
  Stars,
  buzz,
  newId,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  type CommitPatch,
} from '../shared'
import {
  VENN_LIMITS,
  VENN_ZONES,
  activeZones,
  addItem,
  allPlaced,
  checkVenn,
  cycleColor,
  isPlayable,
  normalizeVenn,
  place,
  playableVenn,
  removeItem,
  retryWrong,
  trayOrder,
  unplacedIds,
  updateItem,
  updateSet,
  validateVenn,
  type VennCheck,
  type VennColor,
  type VennData,
  type VennItem,
  type VennPlacement,
  type VennZone,
} from './vennModel'
import { DragGhost, InlineHint, NotReady, ResultIcon, contentKey } from '../Sort/kit'
import { focusSibling, useTapDrag } from '../Sort/useTapDrag'

const TONE = 'info' as const
const TRAY = '__tray__'

/** Set colours: SVG fill/stroke plus text and dot classes. */
const COLOR: Record<VennColor, { hex: string; dot: string; text: string }> = {
  sky: { hex: '#0ea5e9', dot: 'bg-sky-500', text: 'text-sky-700' },
  amber: { hex: '#f59e0b', dot: 'bg-amber-500', text: 'text-amber-700' },
  emerald: { hex: '#10b981', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  rose: { hex: '#f43f5e', dot: 'bg-rose-500', text: 'text-rose-700' },
  violet: { hex: '#8b5cf6', dot: 'bg-violet-500', text: 'text-violet-700' },
}

type Frame = {
  tone: typeof TONE
  icon: React.ReactNode
  editable: boolean
  preview: boolean
  onPreviewChange: (_v: boolean) => void
  nodeView: NodeViewProps
  label: string
}

export default function VennView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeVenn(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: Frame = {
    tone: TONE,
    icon: <Intersect weight="duotone" />,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.venn.title', 'Venn compare'),
  }
  const playable = React.useMemo(() => playableVenn(data), [data])
  return (
    <NodeViewWrapper className="block-exp-venn">
      {editable && !preview ? (
        <VennEditor data={data} commit={commit} frame={frame} />
      ) : (
        <VennPlayer key={contentKey(playable)} data={playable} frame={frame} source={props} />
      )}
    </NodeViewWrapper>
  )
}

/** A tiny two-circle glyph with one region filled (mobile wells, author select). */
function VennGlyph({ zone, a, b, size = 26 }: { zone: VennZone; a: VennColor; b: VennColor; size?: number }) {
  const id = React.useId().replace(/:/g, '')
  const ca = COLOR[a].hex
  const cb = COLOR[b].hex
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 26 16" aria-hidden className="shrink-0 rtl:-scale-x-100">
      <defs>
        <clipPath id={`${id}a`}>
          <circle cx="9.5" cy="8" r="6.5" />
        </clipPath>
        <mask id={`${id}nb`}>
          <rect width="26" height="16" fill="white" />
          <circle cx="16.5" cy="8" r="6.5" fill="black" />
        </mask>
        <mask id={`${id}na`}>
          <rect width="26" height="16" fill="white" />
          <circle cx="9.5" cy="8" r="6.5" fill="black" />
        </mask>
      </defs>
      {zone === 'neither' && <rect x="0.5" y="0.5" width="25" height="15" rx="3" fill="currentColor" opacity="0.18" />}
      {zone === 'a' && <circle cx="9.5" cy="8" r="6.5" fill={ca} opacity="0.75" mask={`url(#${id}nb)`} />}
      {zone === 'b' && <circle cx="16.5" cy="8" r="6.5" fill={cb} opacity="0.75" mask={`url(#${id}na)`} />}
      {zone === 'both' && <circle cx="16.5" cy="8" r="6.5" fill="currentColor" opacity="0.6" clipPath={`url(#${id}a)`} />}
      <circle cx="9.5" cy="8" r="6.5" fill="none" stroke={ca} strokeWidth="1.3" />
      <circle cx="16.5" cy="8" r="6.5" fill="none" stroke={cb} strokeWidth="1.3" />
    </svg>
  )
}

// ─── Author: edit in place ──────────────────────────────────────────────────
// The learner's diagram with every item already in its correct region (the
// answer key). Group names and items are edited where they sit; "+ Add" in a
// region adds an item there; an item moves by drag, or by tapping its handle
// and then a region (keys 1–4 on the handle). "Why?" opens its explanation.
// The "Neither" area lives behind the gear.

function VennEditor({ data, commit, frame }: { data: VennData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const issues = React.useMemo(() => validateVenn(data), [data])
  const edit = (fn: (_d: VennData) => VennData) =>
    commit((live) => {
      const next = fn(normalizeVenn(live))
      return { sets: next.sets, items: next.items }
    })
  const issueText = (code: string) => t(`editor.experiences.venn.issues.${code}`, ISSUE_FALLBACK[code] ?? code)
  const canRemove = data.items.length > VENN_LIMITS.minItems
  const canAdd = data.items.length < VENN_LIMITS.maxItems
  const [selected, setSelected] = React.useState<string | null>(null)
  const [why, setWhy] = React.useState<string | null>(null)
  const [live, setLive] = React.useState('')
  const rootRef = React.useRef<HTMLDivElement>(null)
  const width = useWidth(rootRef)
  const wide = width >= WIDE

  // Focus a new or neighbouring object once it has rendered.
  const [pendingFocus, setPendingFocus] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!pendingFocus) return
    const el = rootRef.current?.querySelector<HTMLElement>(pendingFocus)
    if (el) el.focus()
    const id = requestAnimationFrame(() => setPendingFocus(null))
    return () => cancelAnimationFrame(id)
  })
  const focusLater = (selector: string) => setPendingFocus(selector)

  const setName = (which: 'a' | 'b') =>
    data.sets[which].label.trim() || (which === 'a' ? t('editor.experiences.venn.set_a_placeholder', 'Group A') : t('editor.experiences.venn.set_b_placeholder', 'Group B'))
  const zoneLabel = (zone: VennZone) =>
    zone === 'both'
      ? t('editor.experiences.venn.zone_both', 'Both')
      : zone === 'neither'
        ? t('editor.experiences.venn.zone_neither', 'Neither')
        : t('editor.experiences.venn.zone_only', { set: setName(zone), defaultValue: 'Only {{set}}' })
  const itemIndex = new Map(data.items.map((it, i) => [it.id, i]))
  const itemName = (it: VennItem) => it.text.trim() || t('editor.experiences.venn.item_placeholder', { n: (itemIndex.get(it.id) ?? 0) + 1, defaultValue: 'Item {{n}}' })
  const zones: VennZone[] = data.showNeither ? ['a', 'both', 'b', 'neither'] : ['a', 'both', 'b']

  const move = (itemId: string, zone: VennZone) => {
    const it = data.items.find((x) => x.id === itemId)
    setSelected(null)
    if (!it) return
    if (it.zone !== zone) edit((d) => updateItem(d, itemId, { zone }))
    setLive(t('editor.experiences.venn.moved', { item: itemName(it), zone: zoneLabel(zone), defaultValue: 'Moved “{{item}}” to {{zone}}.' }))
    focusLater(`[data-chip-id="${itemId}"] [data-grip]`)
  }
  const { drag, itemProps } = useTapDrag({ onDrop: (id, target) => (VENN_ZONES as readonly string[]).includes(target) && move(id, target as VennZone) })

  const addTo = (zone: VennZone) => {
    const id = newId()
    edit((d) => addItem(d, id, zone))
    focusLater(`[data-chip-id="${id}"] textarea`)
  }
  const removeAt = (it: VennItem) => {
    const siblings = data.items.filter((x) => x.zone === it.zone)
    const i = siblings.indexOf(it)
    const next = siblings[i + 1] ?? siblings[i - 1]
    edit((d) => removeItem(d, it.id))
    if (why === it.id) setWhy(null)
    if (selected === it.id) setSelected(null)
    focusLater(next ? `[data-chip-id="${next.id}"] [data-grip]` : `[data-add-zone="${it.zone}"]`)
  }

  const gripKeyDown = (e: React.KeyboardEvent<HTMLElement>, it: VennItem) => {
    if (e.key === 'Escape') {
      setSelected(null)
      return
    }
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= zones.length) {
      e.preventDefault()
      move(it.id, zones[n - 1])
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && canRemove) {
      e.preventDefault()
      removeAt(it)
      return
    }
    focusSibling(e, '[data-grip]', rootRef.current)
  }

  const sel = selected ? data.items.find((x) => x.id === selected) : undefined
  const isTarget = (zone: VennZone) => !!sel && sel.zone !== zone

  const chip = (it: VennItem, compact = false) => {
    const dp = itemProps(it.id)
    const isSel = selected === it.id
    const name = itemName(it)
    const hasWhy = !!it.explanation?.trim()
    const n = (itemIndex.get(it.id) ?? 0) + 1
    return (
      <div
        key={it.id}
        {...dp}
        data-venn-chip=""
        data-chip-id={it.id}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('textarea,[data-no-drag]')) return
          dp.onPointerDown(e)
        }}
        className={cn(
          'lh-exp-raised pointer-events-auto relative inline-flex max-w-full min-w-0 cursor-grab touch-manipulation items-center rounded-xl text-start leading-snug font-medium select-none active:cursor-grabbing',
          compact ? 'min-h-9 px-2.5 py-1.5 text-[13px]' : 'min-h-10 px-3 py-2 text-[14px]',
          EDIT_OBJECT,
          isSel ? 'text-sky-700' : 'text-neutral-800',
          drag?.id === it.id && 'opacity-40',
        )}
      >
        <button
          type="button"
          data-grip=""
          aria-pressed={isSel}
          aria-label={t('editor.experiences.venn.move_item', { item: name, defaultValue: 'Move “{{item}}”' })}
          title={t('editor.experiences.venn.move_hint', 'Drag to another place, or press 1–4')}
          onClick={(e) => {
            e.stopPropagation()
            setSelected(isSel ? null : it.id)
          }}
          onKeyDown={(e) => gripKeyDown(e, it)}
          data-on={isSel ? 'true' : undefined}
          className="lh-exp-tool absolute inset-y-0 start-0 inline-flex w-3 cursor-grab items-center justify-center rounded-s-xl text-neutral-300 outline-none hover:text-neutral-500"
        >
          <DotsSixVertical size={12} weight="bold" aria-hidden />
        </button>
        <InlineText
          fit
          value={it.text}
          onCommit={(text) => edit((d) => updateItem(d, it.id, { text }))}
          ariaLabel={t('editor.experiences.venn.item_placeholder', { n, defaultValue: 'Item {{n}}' })}
          placeholder={t('editor.experiences.venn.item_placeholder', { n, defaultValue: 'Item {{n}}' })}
          maxLength={120}
        />
        <button
          type="button"
          data-no-drag=""
          aria-expanded={why === it.id}
          aria-label={t('editor.experiences.venn.why_label', { item: name, defaultValue: 'Why “{{item}}” belongs here' })}
          title={t('editor.experiences.venn.why_label', { item: name, defaultValue: 'Why “{{item}}” belongs here' })}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setWhy(why === it.id ? null : it.id)
          }}
          data-on={hasWhy || why === it.id ? 'true' : undefined}
          className={cn(
            'lh-exp-tool lh-exp-raised absolute -end-2 -bottom-2 z-10 inline-flex h-5 items-center rounded-full px-1.5 text-[10px] leading-none font-semibold outline-none',
            hasWhy ? 'text-amber-700' : 'text-neutral-400 hover:text-neutral-700',
          )}
        >
          {t('editor.experiences.sort.why', 'Why?')}
        </button>
        <RemoveX floating disabled={!canRemove} onClick={() => removeAt(it)} label={t('editor.experiences.venn.remove_named', { item: name, defaultValue: 'Remove “{{item}}”' })} />
      </div>
    )
  }

  const addGhost = (zone: VennZone, compact = false) =>
    canAdd ? (
      <AddGhost
        data-add-zone={zone}
        onClick={() => addTo(zone)}
        iconSize={12}
        aria-label={t('editor.experiences.venn.add_to', { zone: zoneLabel(zone), defaultValue: 'Add an item to {{zone}}' })}
        className={cn('pointer-events-auto rounded-xl', compact ? 'min-h-9 px-2.5 text-[12px]' : 'min-h-10 px-3')}
      >
        {t('editor.experiences.venn.add_item', 'Add item')}
      </AddGhost>
    ) : null

  const placeButton = (zone: VennZone) =>
    isTarget(zone) && sel ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          move(sel.id, zone)
        }}
        className="lh-exp-raised lh-exp-press pointer-events-auto inline-flex min-h-9 items-center justify-center rounded-xl px-3 text-[13px] font-medium text-neutral-700 outline-none"
      >
        {t('activities.experiences.venn.place_here', 'Put it here')}
      </button>
    ) : null

  const setLabel = (which: 'a' | 'b', className?: string) => {
    const set = data.sets[which]
    const other = data.sets[which === 'a' ? 'b' : 'a']
    return (
      <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
        <button
          type="button"
          data-no-drag=""
          onClick={() => edit((d) => updateSet(d, which, { color: cycleColor(set.color, other.color) }))}
          aria-label={t('editor.experiences.venn.change_color', 'Change colour')}
          title={t('editor.experiences.venn.change_color', 'Change colour')}
          className="-m-1 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full outline-none hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-sky-500/40"
        >
          <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', COLOR[set.color].dot)} />
        </button>
        <InlineText
          fit
          value={set.label}
          onCommit={(label) => edit((d) => updateSet(d, which, { label }))}
          ariaLabel={which === 'a' ? t('editor.experiences.venn.set_a_label', 'First group') : t('editor.experiences.venn.set_b_label', 'Second group')}
          placeholder={which === 'a' ? t('editor.experiences.venn.set_a_placeholder', 'Group A') : t('editor.experiences.venn.set_b_placeholder', 'Group B')}
          maxLength={40}
          className={cn('min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere]', COLOR[set.color].text)}
        />
      </span>
    )
  }

  const idsIn = (zone: VennZone) => data.items.filter((it) => it.zone === zone)
  const ca = COLOR[data.sets.a.color]
  const cb = COLOR[data.sets.b.color]

  // ── Wide: the diagram ──
  const maxCount = Math.max(1, ...(['a', 'both', 'b'] as const).map((z) => idsIn(z).length + (canAdd ? 1 : 0)))
  const stageW = Math.min(width, 720)
  const stageH = Math.round(Math.max(270, stageW * 0.532, (maxCount * 46 + 30) / 0.66))
  const geo = vennGeometry(stageW, stageH)
  const header = (zone: 'a' | 'both' | 'b', ci: number) => (
    <div key={zone} className="flex min-w-0 flex-col items-center gap-1 text-center" style={{ width: geo.boxes[zone].width + 16 }}>
      <span className="inline-flex min-h-8 max-w-full items-center gap-1.5 px-1">
        {zone === 'both' ? <span className="text-[13px] font-semibold text-neutral-600">{t('activities.experiences.venn.both', 'Both')}</span> : setLabel(zone)}
        <kbd aria-hidden className="lh-exp-raised rounded-md px-1.5 text-[11px] font-medium text-neutral-500">
          {ci + 1}
        </kbd>
      </span>
    </div>
  )
  const regionProps = (zone: 'a' | 'both' | 'b') => ({
    'data-drop-target': zone,
    onClick: () => isTarget(zone) && sel && move(sel.id, zone),
    style: { pointerEvents: 'all' as const, cursor: isTarget(zone) ? 'pointer' : undefined },
    fill: drag?.over === zone || isTarget(zone) ? (zone === 'both' ? 'rgba(15,23,42,0.07)' : zone === 'a' ? ca.hex : cb.hex) : 'transparent',
    fillOpacity: drag?.over === zone ? 0.22 : isTarget(zone) ? 0.1 : 0,
    className: 'transition-[fill-opacity] duration-150',
  })
  const diagram = (
    <div className="mx-auto flex w-full flex-col items-center gap-1" style={{ maxWidth: 720 }}>
      <div className="relative flex w-full justify-between" style={{ width: stageW }} dir="ltr">
        <div className="absolute" style={{ left: geo.boxes.a.left - 8 }}>
          {header('a', 0)}
        </div>
        <div className="absolute" style={{ left: geo.boxes.both.left - 8 }}>
          {header('both', 1)}
        </div>
        <div className="absolute" style={{ left: geo.boxes.b.left - 8 }}>
          {header('b', 2)}
        </div>
        <div className="h-9" />
      </div>
      <div className="relative" style={{ width: stageW, height: stageH }} dir="ltr">
        <svg width={stageW} height={stageH} className="absolute inset-0" aria-hidden>
          <ellipse cx={geo.cxA} cy={geo.cy} rx={geo.rx} ry={geo.ry} fill={ca.hex} fillOpacity={0.1} stroke={ca.hex} strokeOpacity={0.55} strokeWidth={1.5} />
          <ellipse cx={geo.cxB} cy={geo.cy} rx={geo.rx} ry={geo.ry} fill={cb.hex} fillOpacity={0.1} stroke={cb.hex} strokeOpacity={0.55} strokeWidth={1.5} />
          <path d={geo.onlyA} {...regionProps('a')} />
          <path d={geo.lens} {...regionProps('both')} />
          <path d={geo.onlyB} {...regionProps('b')} />
        </svg>
        {(['a', 'both', 'b'] as const).map((zone) => (
          <div
            key={zone}
            data-drop-target={zone}
            role="group"
            aria-label={zoneLabel(zone)}
            className="pointer-events-none absolute flex flex-col items-center justify-center gap-1.5"
            style={{ left: geo.boxes[zone].left, width: geo.boxes[zone].width, top: geo.band.top, height: geo.band.height }}
            dir="auto"
          >
            {idsIn(zone).map((it) => chip(it, true))}
            {isTarget(zone) ? placeButton(zone) : addGhost(zone, true)}
          </div>
        ))}
      </div>
    </div>
  )

  // ── Narrow: stacked wells ──
  const well = (zone: VennZone) => {
    const target = isTarget(zone)
    const tint = zone === 'a' ? ca.text : zone === 'b' ? cb.text : 'text-neutral-500'
    return (
      <div
        key={zone}
        data-drop-target={zone}
        role="group"
        aria-label={zoneLabel(zone)}
        onClick={(e) => target && sel && !(e.target as HTMLElement).closest('textarea,button,[data-venn-chip]') && move(sel.id, zone)}
        data-over={drag?.over === zone || target ? 'true' : undefined}
        className={cn('lh-exp-well flex min-h-24 min-w-0 flex-col gap-2 rounded-2xl p-3', zone !== 'both' && 'lh-exp-tinted', tint, target && 'cursor-pointer')}
      >
        <div className="flex items-center gap-2">
          <VennGlyph zone={zone} a={data.sets.a.color} b={data.sets.b.color} />
          {zone === 'a' || zone === 'b' ? setLabel(zone, 'flex-1') : <span className="min-w-0 flex-1 text-[13px] font-semibold text-neutral-700">{zoneLabel(zone)}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {idsIn(zone).map((it) => chip(it))}
          {target ? placeButton(zone) : addGhost(zone)}
        </div>
      </div>
    )
  }

  const neitherItems = idsIn('neither')
  const neitherWell =
    data.showNeither || neitherItems.length ? (
      <div
        data-drop-target="neither"
        role="group"
        aria-label={zoneLabel('neither')}
        onClick={(e) => isTarget('neither') && sel && !(e.target as HTMLElement).closest('textarea,button,[data-venn-chip]') && move(sel.id, 'neither')}
        data-over={drag?.over === 'neither' || isTarget('neither') ? 'true' : undefined}
        className={cn(
          'lh-exp-well flex min-h-16 flex-wrap items-center gap-2 rounded-2xl border border-dashed border-neutral-300/70 p-3 text-neutral-500',
          !data.showNeither && 'border-amber-300',
          isTarget('neither') && 'cursor-pointer',
        )}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-neutral-600">
          <VennGlyph zone="neither" a={data.sets.a.color} b={data.sets.b.color} />
          {zoneLabel('neither')}
          {data.showNeither && (
            <kbd aria-hidden className="lh-exp-raised hidden rounded-md px-1.5 text-[11px] font-medium text-neutral-500 sm:inline">
              4
            </kbd>
          )}
        </span>
        {neitherItems.map((it) => chip(it, true))}
        {isTarget('neither') ? <span className="ms-auto">{placeButton('neither')}</span> : data.showNeither && addGhost('neither', true)}
      </div>
    ) : null

  const whyItem = why ? data.items.find((x) => x.id === why) : undefined
  const itemHints = issues.filter((i) => i.id)
  const settings = (
    <SettingsGear>
      <SettingsToggle
        checked={data.showNeither}
        onChange={(showNeither) => commit({ showNeither })}
        label={t('editor.experiences.venn.show_neither', 'Add a “Neither” area outside the circles')}
        hint={t('editor.experiences.venn.show_neither_hint', 'For items that belong to neither group.')}
      />
    </SettingsGear>
  )

  return (
    <ExperienceFrame
      {...frame}
      wysiwyg
      title={data.title}
      onTitleChange={(title) => commit({ title })}
      instructions={data.instructions}
      onInstructionsChange={(instructions) => commit({ instructions })}
      headerEnd={settings}
      footer={<AnswerKeyHint />}
      live={live}
    >
      <div ref={rootRef} className="flex flex-col gap-4">
        <p className="m-0 text-[13px] leading-snug text-neutral-500">
          {sel
            ? t('editor.experiences.venn.author_selected', { item: itemName(sel), defaultValue: 'Now tap where “{{item}}” belongs.' })
            : t('editor.experiences.venn.author_hint', 'Each item sits where it belongs. Drag an item, or tap its handle and then a place, to move it.')}
        </p>
        {issues.some((i) => !i.id) && (
          <div className="flex flex-col gap-1">
            {issues
              .filter((i) => !i.id)
              .map((i) => (
                <InlineHint key={i.code} severity={i.severity}>
                  {issueText(i.code)}
                </InlineHint>
              ))}
          </div>
        )}
        {width === 0 ? null : wide ? diagram : <div className="flex flex-col gap-3">{(['a', 'both', 'b'] as const).map((z) => well(z))}</div>}
        {neitherWell}
        {whyItem && (
          <div className="rounded-xl bg-[color-mix(in_srgb,var(--exp-paper)_80%,transparent)] px-3 py-2 shadow-[inset_0_0_0_1px_var(--exp-edge)]">
            <span className="mb-0.5 block text-[11px] font-semibold text-neutral-400">
              {t('editor.experiences.venn.why_heading', { item: itemName(whyItem), zone: zoneLabel(whyItem.zone), defaultValue: 'Why “{{item}}” belongs in {{zone}} (shown when a learner gets it wrong)' })}
            </span>
            <InlineText
              key={whyItem.id}
              multiline
              autoFocus
              value={whyItem.explanation ?? ''}
              onCommit={(explanation) => edit((d) => updateItem(d, whyItem.id, { explanation }))}
              ariaLabel={t('editor.experiences.venn.explanation_label', 'Explanation')}
              placeholder={t('editor.experiences.venn.explanation_placeholder', 'Why it belongs there (shown when wrong, optional)')}
              maxLength={300}
              className="text-[13px] leading-relaxed text-neutral-600"
            />
          </div>
        )}
        {itemHints.length > 0 && (
          <div className="flex flex-col gap-1">
            {itemHints.map((i) => {
              const it = data.items.find((x) => x.id === i.id)
              return (
                <InlineHint key={`${i.id}:${i.code}`} severity={i.severity}>
                  {it ? `${itemName(it)}: ${issueText(i.code)}` : issueText(i.code)}
                </InlineHint>
              )
            })}
          </div>
        )}
      </div>
      {drag && <DragGhost x={drag.x} y={drag.y}>{itemName(data.items.find((x) => x.id === drag.id) ?? { id: '', text: '', zone: 'a' })}</DragGhost>}
    </ExperienceFrame>
  )
}

const ISSUE_FALLBACK: Record<string, string> = {
  too_few_items: 'Add at least 3 items.',
  too_many_items: 'Use at most 16 items; learners only see the first 16.',
  empty_set_a: 'Name the first group.',
  empty_set_b: 'Name the second group.',
  same_labels: 'The two groups have the same name.',
  empty_item: 'This item is empty; learners will not see it.',
  duplicate_item: 'Another item has the same text.',
  neither_hidden: 'Turn on the “Neither” area, or learners will not see this item.',
  no_both: 'No item belongs to both groups yet; the overlap is the interesting part.',
}

// ─── Learner ────────────────────────────────────────────────────────────────

/** Width of the play area, measured before paint. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/** Two equal ellipses, symmetric about the middle: region paths and chip boxes in px. */
function vennGeometry(W: number, H: number) {
  const cy = H / 2
  const rx = W * 0.25
  const ry = H * 0.47
  const cxA = W * 0.38
  const cxB = W * 0.62
  const d = (W / 2 - cxA) / rx
  const dy = ry * Math.sqrt(Math.max(0, 1 - d * d))
  const top = `${W / 2} ${cy - dy}`
  const bottom = `${W / 2} ${cy + dy}`
  const arc = (large: 0 | 1, sweep: 0 | 1, to: string) => `A ${rx} ${ry} 0 ${large} ${sweep} ${to}`
  return {
    cy,
    rx,
    ry,
    cxA,
    cxB,
    lens: `M ${top} ${arc(0, 1, bottom)} ${arc(0, 1, top)} Z`,
    onlyA: `M ${top} ${arc(1, 0, bottom)} ${arc(0, 1, top)} Z`,
    onlyB: `M ${top} ${arc(1, 1, bottom)} ${arc(0, 0, top)} Z`,
    boxes: {
      a: { left: W * 0.145, width: W * 0.215 },
      both: { left: W * 0.39, width: W * 0.22 },
      b: { left: W * 0.64, width: W * 0.215 },
    } as Record<'a' | 'both' | 'b', { left: number; width: number }>,
    band: { top: cy - H * 0.33, height: H * 0.66 },
  }
}

const WIDE = 520

function VennPlayer({ data, frame, source }: { data: VennData; frame: Frame; source: NodeViewProps }) {
  const { t } = useTranslation()
  const memory = useExperienceMemory(data.blockId, source)
  const [order, setOrder] = React.useState(() => trayOrder(data))
  const [placement, setPlacement] = React.useState<VennPlacement>({})
  const [selected, setSelected] = React.useState<string | null>(null)
  const [check, setCheck] = React.useState<VennCheck | null>(null)
  const [live, setLive] = React.useState('')
  const [best, setBest] = React.useState<number>(() => memory.read<number>('best', 0))
  const rootRef = React.useRef<HTMLDivElement>(null)
  const width = useWidth(rootRef)
  const wide = width >= WIDE

  const itemById = React.useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data])
  const textOf = (id: string) => itemById.get(id)?.text ?? ''
  const zones = activeZones(data)
  const zoneName = (zone: VennZone | null | undefined) =>
    !zone
      ? ''
      : zone === 'both'
        ? t('activities.experiences.venn.both', { a: data.sets.a.label, b: data.sets.b.label, defaultValue: 'Both' })
        : zone === 'neither'
          ? t('activities.experiences.venn.neither', 'Neither')
          : t('activities.experiences.venn.only', { set: data.sets[zone].label, defaultValue: 'Only {{set}}' })

  const doPlace = (itemId: string, zone: VennZone | null) => {
    if (check || !itemById.has(itemId)) return
    setPlacement((p) => place(p, itemId, zone))
    setSelected(null)
    setLive(
      zone
        ? t('activities.experiences.venn.placed', { item: textOf(itemId), zone: zoneName(zone), defaultValue: 'Placed “{{item}}” in {{zone}}.' })
        : t('activities.experiences.venn.returned', { item: textOf(itemId), defaultValue: 'Moved “{{item}}” back to the tray.' }),
    )
  }

  const { drag, itemProps } = useTapDrag({
    disabled: !!check,
    onDrop: (id, target) => doPlace(id, target === TRAY ? null : (target as VennZone)),
  })

  const tapChip = (id: string) => {
    if (check) return
    const next = selected === id ? null : id
    setSelected(next)
    if (next) setLive(t('activities.experiences.venn.selected', { item: textOf(id), defaultValue: 'Selected “{{item}}”. Now choose where it belongs.' }))
  }

  const onCheck = () => {
    const c = checkVenn(data, placement)
    setCheck(c)
    buzz(c.perfect ? 'correct' : 'wrong')
    setSelected(null)
    setLive(
      c.perfect
        ? t('activities.experiences.venn.perfect', 'Perfect! Everything is in the right place.')
        : t('activities.experiences.venn.result', { correct: c.correct, total: c.total, defaultValue: '{{correct}} of {{total}} correct' }),
    )
    if (c.stars > best) {
      setBest(c.stars)
      memory.write('best', c.stars)
    }
  }

  const onRetryWrong = () => {
    if (!check) return
    setPlacement((p) => retryWrong(p, check))
    setCheck(null)
    setLive(t('activities.experiences.venn.retry_live', 'The wrong ones are back in the tray.'))
  }

  const onReset = () => {
    setOrder(trayOrder(data))
    setPlacement({})
    setCheck(null)
    setSelected(null)
    setLive('')
  }

  if (!isPlayable(data)) {
    return (
      <ExperienceFrame {...frame} title={data.title} instructions={data.instructions}>
        <NotReady>{t('activities.experiences.venn.not_ready', 'This activity is not ready yet.')}</NotReady>
      </ExperienceFrame>
    )
  }

  const tray = unplacedIds(order, placement)
  const placedCount = data.items.length - tray.length
  const ready = allPlaced(data, placement)
  const wrong = check ? data.items.filter((it) => check.results[it.id] === 'wrong') : []
  const idsIn = (zone: VennZone) => order.filter((id) => placement[id] === zone)
  const isTarget = (zone: VennZone) => !check && !!selected && placement[selected] !== zone
  const glow = !!check?.overlapRight

  const chipKeyDown = (e: React.KeyboardEvent<HTMLElement>, id: string) => {
    if (check) return
    if (e.key === 'Escape') {
      setSelected(null)
      return
    }
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= zones.length) {
      e.preventDefault()
      doPlace(id, zones[n - 1])
      return
    }
    focusSibling(e, '[data-venn-chip]', rootRef.current)
  }

  const chip = (id: string, inZone: boolean, compact = false) => {
    const result = check?.results[id]
    const isSel = selected === id
    return (
      <button
        key={id}
        type="button"
        data-venn-chip=""
        {...itemProps(id)}
        onClick={(e) => {
          e.stopPropagation()
          tapChip(id)
        }}
        onKeyDown={(e) => chipKeyDown(e, id)}
        aria-pressed={check ? undefined : isSel}
        aria-disabled={check ? true : undefined}
        data-result={result === 'correct' || result === 'wrong' ? result : undefined}
        className={cn(
          'lh-exp-raised pointer-events-auto inline-flex max-w-full min-w-0 touch-manipulation items-center gap-1.5 rounded-xl text-start leading-snug font-medium outline-none select-none',
          compact ? 'min-h-9 px-2.5 py-1.5 text-[13px]' : 'min-h-10 px-3 py-2 text-[14px]',
          !check && 'lh-exp-press cursor-grab active:cursor-grabbing',
          isSel ? 'text-sky-700' : !result && 'text-neutral-800',
          drag?.id === id && 'opacity-40',
          inZone && !check && 'lh-exp-snap',
          result === 'wrong' && 'lh-exp-wrong-shake',
        )}
      >
        {result && result !== 'unplaced' && <ResultIcon ok={result === 'correct'} size={15} />}
        <span className="pointer-events-none min-w-0 [overflow-wrap:anywhere]">{textOf(id)}</span>
      </button>
    )
  }

  const placeButton = (zone: VennZone) =>
    isTarget(zone) && selected ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          doPlace(selected, zone)
        }}
        className="lh-exp-raised lh-exp-press inline-flex min-h-9 items-center justify-center rounded-xl px-3 text-[13px] font-medium text-neutral-700 outline-none"
      >
        {t('activities.experiences.venn.place_here', 'Put it here')}
      </button>
    ) : null

  // ── Wide: the diagram itself ──
  const maxCount = Math.max(1, ...(['a', 'both', 'b'] as const).map((z) => idsIn(z).length))
  const stageW = Math.min(width, 720)
  const stageH = Math.round(Math.max(270, stageW * 0.532, (maxCount * 48 + 30) / 0.66))
  const geo = vennGeometry(stageW, stageH)
  const ca = COLOR[data.sets.a.color]
  const cb = COLOR[data.sets.b.color]

  const header = (zone: 'a' | 'both' | 'b', ci: number) => {
    const target = isTarget(zone)
    const label =
      zone === 'both' ? (
        <span className="text-[13px] font-semibold text-neutral-600">{t('activities.experiences.venn.both', 'Both')}</span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', COLOR[data.sets[zone].color].dot)} />
          <span className={cn('min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere]', COLOR[data.sets[zone].color].text)}>{data.sets[zone].label}</span>
        </span>
      )
    return (
      <div key={zone} className="flex min-w-0 flex-col items-center gap-1 text-center" style={{ width: geo.boxes[zone].width + 16 }}>
        {target && selected ? (
          <button
            type="button"
            onClick={() => doPlace(selected, zone)}
            aria-label={t('activities.experiences.venn.place_in', { item: textOf(selected), zone: zoneName(zone), defaultValue: 'Put “{{item}}” in {{zone}}' })}
            className="lh-exp-raised lh-exp-press inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg px-2.5 text-neutral-700 outline-none"
          >
            {label}
            <kbd aria-hidden className="text-[11px] font-medium text-neutral-400">{ci + 1}</kbd>
          </button>
        ) : (
          <span className="inline-flex min-h-8 max-w-full items-center gap-1.5 px-1">
            {label}
            {!check && (
              <kbd aria-hidden className="lh-exp-raised rounded-md px-1.5 text-[11px] font-medium text-neutral-500">
                {ci + 1}
              </kbd>
            )}
          </span>
        )}
      </div>
    )
  }

  const regionProps = (zone: 'a' | 'both' | 'b') => ({
    'data-drop-target': zone,
    onClick: () => isTarget(zone) && selected && doPlace(selected, zone),
    style: { pointerEvents: 'all' as const, cursor: isTarget(zone) ? 'pointer' : undefined },
    fill: drag?.over === zone || isTarget(zone) ? (zone === 'both' ? 'rgba(15,23,42,0.07)' : zone === 'a' ? ca.hex : cb.hex) : 'transparent',
    fillOpacity: drag?.over === zone ? 0.22 : isTarget(zone) ? 0.1 : 0,
    className: 'transition-[fill-opacity] duration-150',
  })

  const diagram = (
    <div className="mx-auto flex w-full flex-col items-center gap-1" style={{ maxWidth: 720 }}>
      <div className="relative flex w-full justify-between" style={{ width: stageW }} dir="ltr">
        <div className="absolute" style={{ left: geo.boxes.a.left - 8 }}>
          {header('a', 0)}
        </div>
        <div className="absolute" style={{ left: geo.boxes.both.left - 8 }}>
          {header('both', 1)}
        </div>
        <div className="absolute" style={{ left: geo.boxes.b.left - 8 }}>
          {header('b', 2)}
        </div>
        <div className="h-9" />
      </div>
      <div
        role="group"
        aria-label={t('activities.experiences.venn.diagram_label', { a: data.sets.a.label, b: data.sets.b.label, defaultValue: 'Venn diagram: {{a}} and {{b}}' })}
        className="relative"
        style={{ width: stageW, height: stageH }}
        dir="ltr"
      >
        <svg width={stageW} height={stageH} className="absolute inset-0" aria-hidden>
          <ellipse cx={geo.cxA} cy={geo.cy} rx={geo.rx} ry={geo.ry} fill={ca.hex} fillOpacity={0.1} stroke={ca.hex} strokeOpacity={0.55} strokeWidth={1.5} />
          <ellipse cx={geo.cxB} cy={geo.cy} rx={geo.rx} ry={geo.ry} fill={cb.hex} fillOpacity={0.1} stroke={cb.hex} strokeOpacity={0.55} strokeWidth={1.5} />
          {glow && <path d={geo.lens} className="lh-exp-venn-glow" />}
          <path d={geo.onlyA} {...regionProps('a')} />
          <path d={geo.lens} {...regionProps('both')} />
          <path d={geo.onlyB} {...regionProps('b')} />
        </svg>
        {(['a', 'both', 'b'] as const).map((zone) => (
          <div
            key={zone}
            data-drop-target={zone}
            role="group"
            aria-label={zoneName(zone)}
            className="pointer-events-none absolute flex flex-col items-center justify-center gap-1.5"
            style={{ left: geo.boxes[zone].left, width: geo.boxes[zone].width, top: geo.band.top, height: geo.band.height }}
            dir="auto"
          >
            {idsIn(zone).map((id) => chip(id, true, true))}
          </div>
        ))}
      </div>
    </div>
  )

  // ── Narrow: stacked wells ──
  const well = (zone: VennZone) => {
    const ids = idsIn(zone)
    const target = isTarget(zone)
    const over = drag?.over === zone
    const glowThis = zone === 'both' && glow
    const tint = zone === 'a' ? ca.text : zone === 'b' ? cb.text : 'text-neutral-500'
    return (
      <div
        key={zone}
        data-drop-target={zone}
        role="group"
        aria-label={zoneName(zone)}
        onClick={() => target && selected && doPlace(selected, zone)}
        data-over={over || target ? 'true' : undefined}
        className={cn('lh-exp-well flex min-h-24 min-w-0 flex-col gap-2 rounded-2xl p-3', zone !== 'both' && zone !== 'neither' && 'lh-exp-tinted', tint, target && 'cursor-pointer', glowThis && 'lh-exp-venn-glow-well')}
      >
        <div className="flex items-center gap-2">
          <VennGlyph zone={zone} a={data.sets.a.color} b={data.sets.b.color} />
          <span className={cn('min-w-0 flex-1 text-[13px] font-semibold [overflow-wrap:anywhere]', zone === 'a' || zone === 'b' ? tint : 'text-neutral-700')}>{zoneName(zone)}</span>
          {!check && (
            <kbd aria-hidden className="lh-exp-raised hidden rounded-md px-1.5 text-[11px] font-medium text-neutral-500 sm:inline">
              {zones.indexOf(zone) + 1}
            </kbd>
          )}
        </div>
        <div className="flex flex-wrap gap-2">{ids.map((id) => chip(id, true))}</div>
        {target ? placeButton(zone) : !ids.length && <span className="m-auto text-[13px] text-neutral-400">{t('activities.experiences.venn.zone_empty', 'Drop items here')}</span>}
      </div>
    )
  }

  const neitherWell = (() => {
    if (!data.showNeither) return null
    const ids = idsIn('neither')
    const target = isTarget('neither')
    return (
      <div
        data-drop-target="neither"
        role="group"
        aria-label={zoneName('neither')}
        onClick={() => target && selected && doPlace(selected, 'neither')}
        data-over={drag?.over === 'neither' || target ? 'true' : undefined}
        className={cn('lh-exp-well flex min-h-16 flex-wrap items-center gap-2 rounded-2xl border border-dashed border-neutral-300/70 p-3 text-neutral-500', target && 'cursor-pointer')}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-neutral-600">
          <VennGlyph zone="neither" a={data.sets.a.color} b={data.sets.b.color} />
          {zoneName('neither')}
          {!check && (
            <kbd aria-hidden className="lh-exp-raised hidden rounded-md px-1.5 text-[11px] font-medium text-neutral-500 sm:inline">
              4
            </kbd>
          )}
        </span>
        {ids.map((id) => chip(id, true, true))}
        {target ? <span className="ms-auto">{placeButton('neither')}</span> : null}
      </div>
    )
  })()

  const footer = (
    <ExperienceFooter
      progress={check ? undefined : { done: placedCount, total: data.items.length }}
      stars={check ? check.stars : undefined}
      score={check ? `${check.correct} / ${check.total}` : undefined}
      onRetry={check || placedCount > 0 ? onReset : undefined}
    >
      {!check && best > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          {t('activities.experiences.venn.best', 'Best')}
          <Stars value={best as 0 | 1 | 2 | 3} size={13} />
        </span>
      )}
    </ExperienceFooter>
  )

  return (
    <ExperienceFrame {...frame} title={data.title} instructions={data.instructions} footer={footer} celebrate={!!check?.perfect} live={live}>
      <div ref={rootRef} className="flex flex-col gap-4">
        {!check && (
          <p className="m-0 text-[13px] leading-snug text-neutral-500">
            {selected
              ? t('activities.experiences.venn.selected_hint', { item: textOf(selected), defaultValue: 'Now tap where “{{item}}” belongs.' })
              : t('activities.experiences.venn.hint', 'Drag each item into the circles, or tap an item and then a place.')}
          </p>
        )}

        {/* Tray */}
        {!check && (
          <div
            data-drop-target={TRAY}
            role="group"
            aria-label={t('activities.experiences.venn.tray_label', 'Items to place')}
            onClick={() => selected && placement[selected] && doPlace(selected, null)}
            data-over={drag?.over === TRAY ? 'true' : undefined}
            className={cn('lh-exp-well flex min-h-16 flex-wrap items-center gap-2 rounded-2xl p-3 text-neutral-400', selected && placement[selected] && 'cursor-pointer')}
          >
            {tray.length ? (
              tray.map((id) => chip(id, false))
            ) : (
              <span className="flex items-center gap-2 text-[13px] text-neutral-500">
                <Tray size={16} aria-hidden />
                {t('activities.experiences.venn.tray_empty', 'All placed. Check your answers when you are ready.')}
              </span>
            )}
            {selected && placement[selected] && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  doPlace(selected, null)
                }}
                className="lh-exp-raised lh-exp-press ms-auto inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-neutral-700"
              >
                {t('activities.experiences.venn.back_to_tray', 'Back to the tray')}
              </button>
            )}
          </div>
        )}

        {width === 0 ? null : wide ? diagram : <div className="flex flex-col gap-3">{(['a', 'both', 'b'] as const).map((z) => well(z))}</div>}
        {neitherWell}

        {!check ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onCheck} disabled={!ready} className="lh-exp-key">
              {t('activities.experiences.venn.check', 'Check')}
            </button>
            {!ready && <span className="text-[13px] text-neutral-500">{t('activities.experiences.venn.place_all', 'Place every item to check.')}</span>}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className={cn('m-0 flex items-center gap-2 text-[14px] font-medium', check.perfect ? 'text-emerald-700' : 'text-neutral-700')}>
              <ResultIcon ok={check.perfect} size={16} label="" />
              {check.perfect
                ? t('activities.experiences.venn.perfect', 'Perfect! Everything is in the right place.')
                : t('activities.experiences.venn.result', { correct: check.correct, total: check.total, defaultValue: '{{correct}} of {{total}} correct' })}
            </p>
            {!check.perfect && check.overlapRight && (
              <p className="m-0 text-[13px] text-emerald-700">{t('activities.experiences.venn.overlap_right', 'The overlap is spot on.')}</p>
            )}
            {wrong.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {wrong.map((it) => (
                  <li key={it.id} className="rounded-xl bg-rose-50/70 px-3 py-2 text-[13px] leading-relaxed text-neutral-700">
                    <span className="font-medium text-neutral-900">
                      {t('activities.experiences.venn.belongs_in', { item: it.text, zone: zoneName(it.zone), defaultValue: '“{{item}}” belongs in {{zone}}.' })}
                    </span>
                    {it.explanation && <span className="block text-neutral-600">{it.explanation}</span>}
                  </li>
                ))}
              </ul>
            )}
            {!check.perfect && (
              <div>
                <button type="button" onClick={onRetryWrong} className="lh-exp-key">
                  <ArrowCounterClockwise size={14} weight="bold" aria-hidden />
                  {t('activities.experiences.venn.retry_wrong', 'Retry wrong ones')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {drag && <DragGhost x={drag.x} y={drag.y}>{textOf(drag.id)}</DragGhost>}
    </ExperienceFrame>
  )
}
