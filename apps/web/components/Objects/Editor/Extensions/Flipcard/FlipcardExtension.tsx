'use client'
/*
 Flipcard, in the block's original look: a coloured card with a turn icon,
 the text in the middle, "Click to flip" underneath, and a row of small grey
 controls under the card in the editor.

 Learners click (or press Enter/Space on) the card to flip it; the flip is a
 3D turn, or a short cross-fade under prefers-reduced-motion.

 Authors edit the text right on the card (click the text; click elsewhere on
 the card to turn it over and edit the other side). Text commits on blur;
 every setting is read from node attrs (no local copies), so undo and
 collaborators' edits show at once. Inside a flipcardGrid the card's control
 row also has a drag grip, duplicate and delete.
*/
import { NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import {
  ArrowClockwise,
  ArrowsInSimple,
  ArrowsOutSimple,
  Copy,
  DotsSixVertical,
  Palette,
  Square,
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

const FlipcardExtension: React.FC = (props: any) => {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  const { question = '', answer = '', alignment = 'center' } = props.node.attrs
  const color = props.node.attrs.color
  const style = props.node.attrs.style
  const size = resolveFlipcardSize(props.node.attrs.size)
  const faces = flipcardFaces(color, style)

  const [side, setSide] = React.useState<Side>('front')
  const [styleOpen, setStyleOpen] = React.useState(false)
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
          'border-2 p-6 nice-shadow flex flex-col items-center justify-center text-center rounded-xl',
          facePad,
          isBack ? faces.back : faces.front,
          hidden && 'pointer-events-none',
        )}
        aria-hidden={hidden || undefined}
        inert={hidden || undefined}
      >
        <div className="flex items-center justify-center mb-3 max-md:mb-1.5 select-none pointer-events-none">
          <ArrowClockwise weight="duotone" size={ICON_SIZE[size]} className={cn('opacity-70', isBack && 'rotate-180')} />
        </div>
        <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-y-auto overscroll-contain">
          {isEditable ? (
            <DraftText
              ref={isBack ? backRef : frontRef}
              value={text}
              maxLength={2000}
              ariaLabel={isBack ? t('editor.blocks_v2.flipcard.back_text', 'Back of the card') : t('editor.blocks_v2.flipcard.front_text', 'Front of the card')}
              placeholder={isBack ? t('activities.enter_answer') : t('activities.enter_question')}
              onCommit={(v) => update(isBack ? { answer: v } : { question: v })}
              className={cn(
                'max-h-full cursor-text rounded-md text-center font-medium placeholder:text-current placeholder:opacity-60 hover:bg-white/10 focus:bg-white/15',
                faceTextClass(text, size),
              )}
            />
          ) : (
            <p className={cn('max-h-full w-full whitespace-pre-line break-words text-center font-medium', faceTextClass(text, size), compact && 'max-md:text-[15px] max-md:leading-snug')}>
              {text}
            </p>
          )}
        </div>
        <div className={cn('text-xs opacity-70 mt-3 max-md:mt-1.5 select-none pointer-events-none', compact && 'max-md:hidden')}>
          {isBack ? t('activities.click_to_flip_back') : t('activities.click_to_flip')}
        </div>
      </div>
    )
  }

  const flipFromCard = () => setSide(flipped ? 'front' : 'back')

  const card = (
    // Self-contained coloured cards: the same in every block theme.
    <div data-lhb-keep="" className={cn('flipcard-container relative', sizeClass, mobileClass, !isEditable && 'lh-press')}>
      <div
        className={cn('flipcard-inner cursor-pointer', flipped && 'flipped', !isEditable && 'rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2')}
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
    </div>
  )

  // ── learner ──
  if (!isEditable) {
    return (
      <NodeViewWrapper
        className={cn('flipcard-wrapper flex', inGrid ? 'w-full' : cn('my-4', alignment === 'left' ? 'justify-start' : alignment === 'right' ? 'justify-end' : 'justify-center'))}
      >
        {card}
      </NodeViewWrapper>
    )
  }

  // ── author: the original control row under the card ──
  const sizeIcons: Record<FlipcardSize, React.ReactNode> = {
    small: <ArrowsInSimple weight="duotone" size={12} />,
    medium: <Square weight="duotone" size={12} />,
    large: <ArrowsOutSimple weight="duotone" size={12} />,
  }
  const controls = (
    <div
      contentEditable={false}
      className={cn('flex flex-wrap mt-3 gap-1 justify-center transition-opacity', styleOpen ? 'opacity-100' : 'opacity-60 hover:opacity-100 focus-within:opacity-100')}
    >
      {inGrid && (
        <>
          <CardControl
            {...reorder.gripProps(place!.index, `card-${place!.index}`)}
            aria-label={t('editor.blocks_v2.flipcard.drag', 'Drag to reorder (arrow keys move it)')}
            title={t('editor.blocks_v2.flipcard.drag', 'Drag to reorder (arrow keys move it)')}
            className="cursor-grab touch-none active:cursor-grabbing"
          >
            <DotsSixVertical weight="bold" size={12} />
          </CardControl>
          <ControlDivider />
        </>
      )}
      {!inGrid && (
        <>
          {(['left', 'center', 'right'] as const).map((a) => (
            <CardControl key={a} active={alignment === a} onClick={() => update({ alignment: a })} title={t(`activities.align_${a}`)} aria-label={t(`activities.align_${a}`)}>
              {a === 'left' ? <TextAlignLeft weight="duotone" size={12} /> : a === 'center' ? <TextAlignCenter weight="duotone" size={12} /> : <TextAlignRight weight="duotone" size={12} />}
            </CardControl>
          ))}
          <ControlDivider />
        </>
      )}
      {(['small', 'medium', 'large'] as FlipcardSize[]).map((s) => (
        <CardControl key={s} active={size === s} onClick={() => update({ size: s })} title={t(`activities.size_${s}`)} aria-label={t(`activities.size_${s}`)}>
          {sizeIcons[s]}
        </CardControl>
      ))}
      <ControlDivider />
      <BlockPopover
        open={styleOpen}
        onOpenChange={setStyleOpen}
        align="center"
        width={264}
        title={t('editor.blocks_v2.flipcard.look', 'Card look')}
        trigger={
          <CardControl title={t('activities.change_color')} aria-label={t('activities.change_color')}>
            <Palette weight="duotone" size={12} />
          </CardControl>
        }
      >
        <FlipcardStylePicker look={{ color, style, size }} onChange={(patch: FlipcardLook) => update({ ...patch })} showSize={false} />
      </BlockPopover>
      <CardControl onClick={() => turn(flipped ? 'front' : 'back', true)} title={t('activities.preview_flip')} aria-label={t('activities.preview_flip')}>
        <ArrowClockwise weight="duotone" size={12} />
      </CardControl>
      {!inGrid ? (
        <CardControl
          onClick={() => {
            const p = typeof props.getPos === 'function' ? props.getPos() : null
            if (typeof p === 'number') groupIntoGrid(props.editor, p)
          }}
          title={t('activities.group_into_grid')}
          aria-label={t('activities.group_into_grid')}
        >
          <SquaresFour weight="duotone" size={12} />
        </CardControl>
      ) : (
        <>
          <CardControl
            onClick={() => {
              const p = currentPlace()
              if (p) insertCard(props.editor, p.gridPos, { ...props.node.attrs }, p.index)
            }}
            title={t('editor.drag_handle.duplicate', 'Duplicate')}
            aria-label={t('editor.drag_handle.duplicate', 'Duplicate')}
          >
            <Copy weight="duotone" size={12} />
          </CardControl>
          <CardControl
            onClick={() => {
              const p = currentPlace()
              if (p) deleteCard(props.editor, p.gridPos, p.index)
            }}
            title={t('editor.blocks_v2.flipcard.delete_card', 'Delete card')}
            aria-label={t('editor.blocks_v2.flipcard.delete_card', 'Delete card')}
            className="hover:!bg-red-100 hover:!text-red-600"
          >
            <Trash weight="duotone" size={12} />
          </CardControl>
        </>
      )}
    </div>
  )

  if (inGrid) {
    return (
      <NodeViewWrapper ref={wrapperRef} data-reorder-item="" className={cn('flipcard-wrapper flex w-full flex-col transition-opacity', reorder.drag && 'opacity-50')}>
        {card}
        {controls}
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className={cn('flipcard-wrapper flex my-4', alignment === 'left' ? 'justify-start' : alignment === 'right' ? 'justify-end' : 'justify-center')}>
      <EditorBlockFrame editable node={props.node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="interactive">
        <div className="flex flex-col">
          {card}
          {controls}
        </div>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default FlipcardExtension
