'use client'
/*
 Flipcard: a coloured card with a turn icon, the text in the middle and
 "Click to flip" underneath. In the editor the card looks exactly as learners
 see it; a small grip (top edge, deck cards only) and a ⋯ menu appear on hover.

 Learners click (or press Enter/Space on) the card to flip it; the flip is a
 3D turn, or a short cross-fade under prefers-reduced-motion.

 Authors edit the text right on the card (click the text; click elsewhere on
 the card to turn it over and edit the other side). Text commits on blur;
 every setting is read from node attrs (no local copies), so undo and
 collaborators' edits show at once. The ⋯ menu holds flip, look, duplicate,
 move and delete; inside a deck every card uses the deck's size so the grid
 stays even.
*/
import { NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  Copy,
  DotsSixVertical,
  DotsThree,
  Palette,
  SquaresFour,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  Trash,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover } from '../../Blocks/ui/BlockChrome'
import { DraftText, type DraftTextHandle } from '../../Blocks/ui/DraftText'
import { usePointerReorder } from '../../Blocks/ui/usePointerReorder'
import { isCompactFlipcardGrid } from './compactGrid'
import { FlipcardStylePicker, type FlipcardLook } from './FlipcardStylePicker'
import { SIZE_BOX, faceTextClass, flipcardFaces, resolveFlipcardSize, type FlipcardSize } from './flipcardStyles'
import { cardPlace, deleteCard, groupIntoGrid, insertCard, moveCardInGrid, takeCardFocus } from './flipcardOps'
import { cardKey, shuffleOrder } from './flashcardStudyModel'

/** One shuffle per page visit, shared by every card. */
const SHUFFLE_SEED = Math.floor(Math.random() * 1e9)

type Side = 'front' | 'back'

/** The original control button: small, grey, dark when active. */
export function CardControl({ active, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        'p-1.5 rounded-md transition-colors text-xs outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50',
        active ? 'bg-neutral-700 text-white' : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-600',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export const ControlDivider = () => <div aria-hidden className="w-px h-4 bg-neutral-300 self-center mx-1" />

const ICON_SIZE: Record<FlipcardSize, number> = { small: 16, medium: 20, large: 24 }

/** A small, stable tilt per card (about ±0.9°), seeded by its text so it never jumps. */
export function cardTilt(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  const unit = ((h >>> 0) % 1000) / 999 // 0..1
  const deg = (unit * 2 - 1) * 0.9
  // Never almost-straight: keep at least 0.35° so the deck reads as hand-laid.
  return Math.abs(deg) < 0.35 ? (deg < 0 ? -0.35 : 0.35) : Math.round(deg * 100) / 100
}

const FlipcardExtension: React.FC = (props: any) => {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  const { question = '', answer = '', alignment = 'center' } = props.node.attrs
  const color = props.node.attrs.color
  const style = props.node.attrs.style
  const faces = flipcardFaces(color, style)

  const [side, setSide] = React.useState<Side>('front')
  const [menuOpen, setMenuOpen] = React.useState(false)
  const frontRef = React.useRef<DraftTextHandle>(null)
  const backRef = React.useRef<DraftTextHandle>(null)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const gridRef = React.useRef<HTMLElement | null>(null)
  const flipped = side === 'back'

  // Inside a flipcardGrid the container owns the layout: the card fills its
  // cell and per-card alignment stops meaning anything.
  const pos = typeof props.getPos === 'function' ? props.getPos() : null
  const place = cardPlace(props.editor, pos)
  const inGrid = !!place
  // Two cards share a phone's width in a compact grid, so they shrink further.
  const compact = inGrid && isCompactFlipcardGrid(place!.grid)
  // Every card in a deck takes the deck's size (its first card's), so the grid stays even.
  const size = resolveFlipcardSize(inGrid ? place!.grid.firstChild?.attrs?.size : props.node.attrs.size)

  const update = (attrs: Record<string, unknown>) => props.updateAttributes(attrs)
  // Positions are read at event time: a node view isn't re-rendered when only its position changes.
  const currentPlace = () => cardPlace(props.editor, typeof props.getPos === 'function' ? props.getPos() : null)

  // Reorder inside the grid: the list is the grid's wrapper, the items its cards.
  React.useLayoutEffect(() => {
    gridRef.current = wrapperRef.current?.closest<HTMLElement>('[data-reorder-list]') ?? null
  })
  const reorder = usePointerReorder({
    containerRef: gridRef,
    count: place?.grid.childCount ?? 1,
    axis: 'xy',
    onMove: (from, to) => {
      const p = currentPlace()
      if (p) moveCardInGrid(props.editor, p.gridPos, from, to)
    },
  })

  // Show where a dragged card will land (the target is another node view).
  React.useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    grid.querySelectorAll<HTMLElement>('[data-reorder-item]').forEach((el, i) => {
      if (reorder.drag && i === reorder.drag.over && reorder.drag.over !== reorder.drag.from) el.setAttribute('data-drop-target', '')
      else el.removeAttribute('data-drop-target')
    })
  }, [reorder.drag])

  // A card just added from the grid takes focus.
  React.useEffect(() => {
    const p = currentPlace()
    if (p && takeCardFocus(p.gridPos, p.index) === 'text') requestAnimationFrame(() => frontRef.current?.focus())
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const turn = (next: Side, focusText = false) => {
    setSide(next)
    // Wait for the turn to get going so the field isn't focused mid-rotation.
    if (isEditable && focusText) setTimeout(() => (next === 'front' ? frontRef : backRef).current?.focus(), 200)
  }

  const box = SIZE_BOX[size]
  const sizeClass = inGrid ? cn('w-full', box.h) : cn(box.w, box.h, 'max-w-full')
  const mobileClass = compact ? 'max-md:h-32' : size === 'large' ? 'max-md:w-full max-md:h-44' : 'max-md:w-full max-md:h-36'
  const facePad = compact ? 'max-md:p-3' : 'max-md:p-4'

  const face = (which: Side) => {
    const isBack = which === 'back'
    const text = isBack ? answer : question
    const hidden = isBack !== flipped
    return (
      <div
        className={cn(
          isBack ? 'flipcard-back' : 'flipcard-front',
          // A physical card: three even rows (side label, centred text, hint), a hairline edge,
          // a faint top sheen and a layered soft shadow that lifts a touch on hover for learners.
          'grid grid-rows-[1.5rem_minmax(0,1fr)_1.5rem] gap-2 overflow-hidden border p-5 text-center rounded-2xl transition-[box-shadow,transform] duration-200',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_2px_rgba(15,23,42,0.06),0_4px_12px_-8px_rgba(15,23,42,0.16)]',
          !isEditable && 'group-hover/card:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_3px_rgba(15,23,42,0.07),0_8px_18px_-10px_rgba(15,23,42,0.2)]',
          facePad,
          isBack ? faces.back : faces.front,
          hidden && 'pointer-events-none',
        )}
        aria-hidden={hidden || undefined}
        inert={hidden || undefined}
      >
        <span aria-hidden className="lh-exp-grain pointer-events-none absolute inset-0 rounded-2xl" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/3 rounded-t-2xl bg-gradient-to-b from-white/[0.07] to-transparent" />
        {/* Which side is up, at a glance: "Question" / "Answer" and the turn icon. */}
        <div className={cn('relative flex w-full items-center justify-between gap-2 select-none pointer-events-none', compact && 'max-md:invisible')}>
          <span className="text-[12px] font-medium opacity-75">
            {isBack ? t('activities.experiences.flashcards.answer_side', 'Answer') : t('activities.experiences.flashcards.question_side', 'Question')}
          </span>
          <ArrowClockwise weight="duotone" size={ICON_SIZE[size] - 4} className={cn('opacity-60', isBack && 'rotate-180')} />
        </div>
        <div className="relative flex min-h-0 w-full items-center justify-center overflow-y-auto overscroll-contain">
          {isEditable ? (
            <DraftText
              ref={isBack ? backRef : frontRef}
              value={text}
              maxLength={2000}
              ariaLabel={isBack ? t('editor.blocks_v2.flipcard.back_text', 'Back of the card') : t('editor.blocks_v2.flipcard.front_text', 'Front of the card')}
              placeholder={isBack ? t('activities.enter_answer') : t('activities.enter_question')}
              onCommit={(v) => update(isBack ? { answer: v } : { question: v })}
              className={cn(
                'max-h-full cursor-text rounded-md text-center font-semibold tracking-[-0.01em] placeholder:text-current placeholder:opacity-60 hover:bg-white/10 focus:bg-white/15',
                faceTextClass(text, size),
              )}
            />
          ) : (
            <p
              dir="auto"
              className={cn(
                'max-h-full w-full whitespace-pre-line break-words text-center font-semibold tracking-[-0.01em]',
                faceTextClass(text, size),
                compact && 'max-md:text-[15px] max-md:leading-snug',
              )}
            >
              {text}
            </p>
          )}
        </div>
        <div className={cn('relative flex items-center justify-center select-none pointer-events-none', compact && 'max-md:invisible')}>
          <span className="inline-flex items-center gap-1 rounded-full bg-current/10 px-2 py-0.5 text-[11px] font-medium">
            <ArrowClockwise size={11} weight="bold" aria-hidden className={cn(isBack && '-scale-x-100')} />
            {isBack ? t('activities.click_to_flip_back') : t('activities.click_to_flip')}
          </span>
        </div>
      </div>
    )
  }

  const flipFromCard = () => setSide(flipped ? 'front' : 'back')

  // ── author: grip (deck cards) and ⋯ menu, shown on hover/focus, always on touch ──
  const toolBtn =
    'inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-neutral-600 shadow-[0_1px_2px_rgba(15,23,42,0.12),0_0_0_1px_rgba(15,23,42,0.06)] backdrop-blur outline-none hover:bg-white hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-sky-500/50'
  const menuItem =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[13px] text-neutral-700 outline-none hover:bg-neutral-100 focus-visible:bg-neutral-100 disabled:pointer-events-none disabled:opacity-40'
  const cardIndex = place?.index ?? 0
  const cardCount = place?.grid.childCount ?? 1
  const moveTo = (to: number) => {
    const p = currentPlace()
    if (p && to >= 0 && to < p.grid.childCount) moveCardInGrid(props.editor, p.gridPos, p.index, to)
  }
  const authorTools = isEditable ? (
    <div contentEditable={false} className="lh-card-tools pointer-events-none absolute inset-0 z-10">
      {inGrid && cardCount > 1 && (
        <div
          {...reorder.gripProps(cardIndex, `card-${cardIndex}`)}
          role="button"
          tabIndex={0}
          aria-label={t('editor.blocks_v2.flipcard.drag', 'Drag to reorder (arrow keys move it)')}
          title={t('editor.blocks_v2.flipcard.drag', 'Drag to reorder (arrow keys move it)')}
          className="lh-card-tool pointer-events-auto absolute inset-x-10 top-0 flex h-8 cursor-grab touch-none items-start justify-center pt-1 outline-none active:cursor-grabbing focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-sky-500/50"
        >
          <span className="inline-flex h-4 items-center rounded-full bg-white/85 px-2 text-neutral-500 shadow-[0_0_0_1px_rgba(15,23,42,0.06)]">
            <DotsSixVertical weight="bold" size={12} className="rotate-90" />
          </span>
        </div>
      )}
      <div className="lh-card-tool pointer-events-auto absolute end-2 top-2">
        <BlockPopover
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="end"
          width={256}
          trigger={
            <button type="button" aria-label={t('editor.blocks_v2.flipcard.card_menu', 'Card options')} title={t('editor.blocks_v2.flipcard.card_menu', 'Card options')} className={toolBtn}>
              <DotsThree weight="bold" size={16} />
            </button>
          }
        >
          <div className="-m-1 flex flex-col gap-0.5">
            <button type="button" className={menuItem} onClick={() => { turn(flipped ? 'front' : 'back', true); setMenuOpen(false) }}>
              <ArrowClockwise size={14} />
              {flipped ? t('editor.blocks_v2.flipcard.show_front', 'Show the front') : t('editor.blocks_v2.flipcard.show_back', 'Show the back')}
            </button>
            {inGrid ? (
              <>
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    const p = currentPlace()
                    if (p) insertCard(props.editor, p.gridPos, { ...props.node.attrs }, p.index)
                    setMenuOpen(false)
                  }}
                >
                  <Copy size={14} />
                  {t('editor.drag_handle.duplicate', 'Duplicate')}
                </button>
                <button type="button" className={menuItem} disabled={cardIndex === 0} onClick={() => { moveTo(cardIndex - 1); setMenuOpen(false) }}>
                  <ArrowLeft size={14} className="rtl:-scale-x-100" />
                  {t('editor.blocks_v2.flipcard.move_earlier', 'Move earlier')}
                </button>
                <button type="button" className={menuItem} disabled={cardIndex >= cardCount - 1} onClick={() => { moveTo(cardIndex + 1); setMenuOpen(false) }}>
                  <ArrowRight size={14} className="rtl:-scale-x-100" />
                  {t('editor.blocks_v2.flipcard.move_later', 'Move later')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  const p = typeof props.getPos === 'function' ? props.getPos() : null
                  if (typeof p === 'number') groupIntoGrid(props.editor, p)
                  setMenuOpen(false)
                }}
              >
                <SquaresFour size={14} />
                {t('activities.group_into_grid')}
              </button>
            )}
            <div aria-hidden className="my-1 h-px bg-neutral-100" />
            <div className="px-1 pb-1">
              <FlipcardStylePicker look={{ color, style, size }} onChange={(patch: FlipcardLook) => update({ ...patch })} showSize={!inGrid} />
            </div>
            {!inGrid && (
              <div className="flex gap-1 px-1 pb-1">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <CardControl key={a} active={alignment === a} onClick={() => update({ alignment: a })} title={t(`activities.align_${a}`)} aria-label={t(`activities.align_${a}`)}>
                    {a === 'left' ? <TextAlignLeft weight="duotone" size={12} /> : a === 'center' ? <TextAlignCenter weight="duotone" size={12} /> : <TextAlignRight weight="duotone" size={12} />}
                  </CardControl>
                ))}
              </div>
            )}
            {inGrid && (
              <>
                <div aria-hidden className="my-1 h-px bg-neutral-100" />
                <button
                  type="button"
                  className={cn(menuItem, 'text-rose-600 hover:bg-rose-50 focus-visible:bg-rose-50')}
                  onClick={() => {
                    const p = currentPlace()
                    setMenuOpen(false)
                    if (p) deleteCard(props.editor, p.gridPos, p.index)
                  }}
                >
                  <Trash size={14} />
                  {t('editor.blocks_v2.flipcard.delete_card', 'Delete card')}
                </button>
              </>
            )}
          </div>
        </BlockPopover>
      </div>
    </div>
  ) : null

  const card = (
    // Self-contained coloured cards: the same in every block theme.
    <div
      data-lhb-keep=""
      className={cn('flipcard-container group/card relative', sizeClass, mobileClass, !isEditable && 'lh-press lh-flip-tilt')}
      style={!isEditable ? ({ ['--lh-tilt' as any]: `${cardTilt(`${question}|${answer}`)}deg` } as React.CSSProperties) : undefined}
    >
      <div
        className={cn('flipcard-inner cursor-pointer', flipped && 'flipped', !isEditable && 'rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2')}
        {...(isEditable
          ? {
              // Clicking the text edits it; clicking anywhere else on the card turns it over.
              onClick: (e: React.MouseEvent) => {
                if ((e.target as HTMLElement).tagName !== 'TEXTAREA') flipFromCard()
              },
            }
          : {
              role: 'button',
              tabIndex: 0,
              'aria-pressed': flipped,
              'aria-label': `${flipped ? answer : question} — ${flipped ? t('activities.click_to_flip_back') : t('activities.click_to_flip')}`,
              onClick: flipFromCard,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  flipFromCard()
                }
              },
            })}
      >
        {face('front')}
        {face('back')}
      </div>
      {authorTools}
    </div>
  )

  // ── learner ──
  if (!isEditable) {
    // A shuffled deck: each card takes a per-visit CSS order (the grid's holder is display: contents).
    const order = inGrid && place!.grid.attrs?.shuffle === true ? shuffleOrder(SHUFFLE_SEED, cardKey(question, answer) + place!.index) : undefined
    return (
      <NodeViewWrapper
        className={cn('flipcard-wrapper flex', inGrid ? 'w-full' : cn('my-4', alignment === 'left' ? 'justify-start' : alignment === 'right' ? 'justify-end' : 'justify-center'))}
        style={order === undefined ? undefined : { order }}
      >
        {card}
      </NodeViewWrapper>
    )
  }

  if (inGrid) {
    return (
      <NodeViewWrapper
        ref={wrapperRef}
        data-reorder-item=""
        data-menu-open={menuOpen || undefined}
        className={cn('flipcard-wrapper group/tools flex w-full flex-col transition-opacity', reorder.drag && reorder.drag.from === cardIndex && 'opacity-50')}
      >
        {card}
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className={cn('flipcard-wrapper flex my-4', alignment === 'left' ? 'justify-start' : alignment === 'right' ? 'justify-end' : 'justify-center')}>
      <EditorBlockFrame editable node={props.node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="interactive">
        <div className="group/tools flex flex-col" data-menu-open={menuOpen || undefined}>
          {card}
        </div>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default FlipcardExtension
