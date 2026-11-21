'use client'
/*
 Flashcards (flipcardGrid): a deck of flipcards.

 Learners see the grid (the old look, polished) or study mode, one card at a
 time with Again / Hard / Got it (FlashcardStudy). The deck's `mode` attr
 picks where they start; a Grid / Study toggle sits above the deck.

 Authors edit the deck as learners see it: an even grid of cards, edited in
 place (each card's grip and ⋯ menu appear on hover, see FlipcardExtension),
 with a faded "+ Add card" in the next cell. Or as a list (question | answer
 rows). One header holds the title, a Cards / List switch, Preview (study
 mode) and a gear with columns, the look of every card, start mode, shuffle,
 paste a list and ungroup.

 The cards stay child nodes (NodeViewContent) in every view: the list and
 study views only hide them, so ProseMirror's content is never unmounted.
*/
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import { Cards, ClipboardText, Eye, GearSix, ListBullets, PencilSimple, Plus, Rows, Shuffle, SquaresFour, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, Segmented, TEXTAREA_CLASS } from '../../Blocks/ui/BlockChrome'
import DraftText from '../../Blocks/ui/DraftText'
import { isCompactFlipcardGrid } from './compactGrid'
import { CardControl } from './FlipcardExtension'
import { FlipcardStylePicker, type FlipcardLook } from './FlipcardStylePicker'
import { FlashcardStudy, type StudyDeckCard } from './FlashcardStudy'
import { type GridMode, parseBulkCards, resolveDeckAttrs, toStudyCards } from './flashcardStudyModel'
import { NEW_CARD_TEXT, appendCards, applyToAllCards, deleteCard, insertCard, requestCardFocus, ungroupGrid, updateCardAttrs } from './flipcardOps'

const COLUMN_OPTIONS = [2, 3, 4]

type Panel = 'cards' | 'list' | 'study'

/** Column-count glyph (the original used lucide's Columns2/3/4). */
function ColumnsGlyph({ n }: { n: number }) {
  const w = 10 / n
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="1" y="1.5" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      {Array.from({ length: n - 1 }, (_, i) => (
        <line key={i} x1={1 + w * (i + 1)} y1="1.5" x2={1 + w * (i + 1)} y2="10.5" stroke="currentColor" strokeWidth="1.2" />
      ))}
    </svg>
  )
}

function deckCards(node: any): StudyDeckCard[] {
  const raw: any[] = []
  node.forEach((card: any) => raw.push(card.attrs || {}))
  return toStudyCards(raw).map((c, i) => ({ ...c, color: raw[i].color, style: raw[i].style }))
}

const FlipcardGridExtension: React.FC = (props: any) => {
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  return isEditable ? <GridEditor {...props} /> : <GridLearner {...props} />
}

function gridWrapperProps(props: any, columns: number) {
  return {
    className: 'flipcard-grid my-4',
    'data-reorder-list': '',
    // Short-term grids stay two-up on phones (mobile-activities.css).
    'data-compact': isCompactFlipcardGrid(props.node) ? '' : undefined,
    style: { ['--flipcard-grid-columns' as any]: columns },
  }
}

// ── learner ──────────────────────────────────────────────────────────────────

function GridLearner(props: any) {
  const { t } = useTranslation()
  const deck = resolveDeckAttrs(props.node.attrs)
  const columns: number = props.node.attrs.columns || 2
  const [view, setView] = React.useState<GridMode>(deck.mode)
  const cards = React.useMemo(() => deckCards(props.node), [props.node])
  const showBar = cards.length >= 2 || !!deck.title

  return (
    <NodeViewWrapper {...gridWrapperProps(props, columns)} data-view={view}>
      {showBar && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2" contentEditable={false}>
          <span aria-hidden className="lh-exp-icon inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Cards size={20} weight="duotone" />
          </span>
          <div className="min-w-0 flex-1">
            {deck.title && <h3 className="m-0 truncate text-[15px] font-semibold text-neutral-900">{deck.title}</h3>}
            <p className="m-0 text-[12px] text-neutral-500">
              {t('activities.experiences.flashcards.card_count', { count: cards.length, defaultValue: 'Cards: {{count}}' })}
            </p>
          </div>
          {cards.length >= 2 && (
            <div className="w-[11rem] flex-none">
              <Segmented<GridMode>
                ariaLabel={t('activities.experiences.flashcards.view_label', 'View')}
                value={view}
                onChange={setView}
                options={[
                  { value: 'grid', label: <><SquaresFour size={13} weight="duotone" />{t('activities.experiences.flashcards.view_grid', 'Grid')}</> },
                  { value: 'study', label: <><Cards size={13} weight="duotone" />{t('activities.experiences.flashcards.view_study', 'Study')}</> },
                ]}
              />
            </div>
          )}
        </div>
      )}
      <div className={view === 'study' ? 'hidden' : undefined}>
        <NodeViewContent className="flipcard-grid-content" />
      </div>
      {view === 'study' && (
        <div className="lh-exp-frame rounded-2xl bg-white p-3 shadow-[0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_6px_18px_-12px_rgba(15,23,42,0.1)] sm:p-4" contentEditable={false}>
          <FlashcardStudy cards={cards} shuffle={deck.shuffle} memorySource={props} />
        </div>
      )}
    </NodeViewWrapper>
  )
}

// ── author ───────────────────────────────────────────────────────────────────

function GridEditor(props: any) {
  const { t } = useTranslation()
  const deck = resolveDeckAttrs(props.node.attrs)
  const columns: number = props.node.attrs.columns || 2
  const [panel, setPanel] = React.useState<Panel>('cards')
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [pasteOpen, setPasteOpen] = React.useState(false)
  const cards = React.useMemo(() => deckCards(props.node), [props.node])

  const gridPos = () => (typeof props.getPos === 'function' ? props.getPos() : null)
  const last = props.node.lastChild?.attrs ?? {}
  // New cards copy the look of the last one, so a styled deck stays consistent.
  const newCardLook = () => ({ color: last.color ?? 'blue', style: last.style ?? 'solid', size: last.size ?? 'medium', alignment: 'center' })

  const addCard = () => {
    const pos = gridPos()
    if (typeof pos !== 'number') return
    const at = insertCard(props.editor, pos, { ...newCardLook(), ...NEW_CARD_TEXT })
    if (at >= 0 && panel === 'cards') requestCardFocus(pos, at, 'text')
  }

  const first = props.node.firstChild?.attrs ?? {}
  const applyAll = (patch: FlipcardLook) => {
    const pos = gridPos()
    if (typeof pos === 'number') applyToAllCards(props.editor, pos, patch as Record<string, unknown>)
  }

  const paste = (rows: { question: string; answer: string }[]) => {
    const pos = gridPos()
    if (typeof pos !== 'number' || rows.length === 0) return
    appendCards(props.editor, pos, rows.map((r) => ({ ...newCardLook(), ...r })))
    setPasteOpen(false)
  }

  const label = t('editor.blocks_v2.flipcard.grid_label', { count: props.node.childCount, defaultValue: 'Flipcards · {{count}}' })
  const preview = panel === 'study'
  const sectionLabel = 'text-xs font-medium text-neutral-600'
  const headerBtn =
    'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40'

  return (
    <NodeViewWrapper {...gridWrapperProps(props, columns)}>
      <EditorBlockFrame editable node={props.node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="interactive" label={label}>
        <div className="mb-4 flex pt-6 flex-wrap items-center gap-x-3 gap-y-2" contentEditable={false}>
          <span aria-hidden className="lh-exp-icon inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Cards size={20} weight="duotone" />
          </span>
          <div className="min-w-[10rem] flex-1">
            <DraftText
              value={deck.title}
              multiline={false}
              maxLength={120}
              placeholder={t('editor.experiences.flashcards.title_placeholder', 'Deck title (optional)')}
              ariaLabel={t('editor.experiences.flashcards.title_label', 'Deck title')}
              onCommit={(v) => props.updateAttributes({ title: v })}
              className="rounded-md text-[15px] font-semibold text-neutral-900 placeholder:font-medium placeholder:text-neutral-400 hover:bg-neutral-50 focus:bg-white"
            />
            <p className="m-0 text-[12px] text-neutral-500">
              {t('activities.experiences.flashcards.card_count', { count: cards.length, defaultValue: 'Cards: {{count}}' })}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {!preview && (
              <div className="w-[9.5rem]">
                <Segmented<Panel>
                  ariaLabel={t('editor.experiences.flashcards.panel_label', 'Edit view')}
                  value={panel}
                  onChange={setPanel}
                  options={[
                    { value: 'cards', label: <><SquaresFour size={13} weight="duotone" />{t('editor.experiences.flashcards.panel_cards', 'Cards')}</> },
                    { value: 'list', label: <><ListBullets size={13} />{t('editor.experiences.flashcards.panel_list', 'List')}</> },
                  ]}
                />
              </div>
            )}
            <button
              type="button"
              aria-pressed={preview}
              onClick={() => setPanel(preview ? 'cards' : 'study')}
              className={cn(headerBtn, preview ? 'bg-neutral-900 text-white hover:bg-neutral-800' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900')}
            >
              {preview ? <PencilSimple size={13} weight="bold" aria-hidden /> : <Eye size={13} weight="bold" aria-hidden />}
              {preview ? t('editor.experiences.common.back_to_editing', 'Back to editing') : t('editor.experiences.common.preview', 'Preview')}
            </button>
            <BlockPopover
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              align="end"
              width={288}
              title={t('editor.experiences.flashcards.settings', 'Deck settings')}
              trigger={
                <button
                  type="button"
                  aria-label={t('editor.experiences.flashcards.settings', 'Deck settings')}
                  title={t('editor.experiences.flashcards.settings', 'Deck settings')}
                  className={cn(headerBtn, 'w-8 justify-center bg-neutral-100 px-0 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900')}
                >
                  <GearSix size={15} weight="duotone" />
                </button>
              }
            >
              <div className="flex flex-col gap-1.5">
                <span className={sectionLabel}>{t('editor.experiences.flashcards.columns', 'Cards per row')}</span>
                <div className="flex gap-1">
                  {COLUMN_OPTIONS.map((value) => (
                    <CardControl
                      key={value}
                      active={columns === value}
                      onClick={() => props.updateAttributes({ columns: value })}
                      title={t(`activities.grid_columns_${value}`)}
                      aria-label={t(`activities.grid_columns_${value}`)}
                    >
                      <ColumnsGlyph n={value} />
                    </CardControl>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className={sectionLabel}>{t('editor.blocks_v2.flipcard.look_all', 'Style every card')}</span>
                <FlipcardStylePicker look={{ color: first.color, style: first.style, size: first.size }} onChange={applyAll} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className={sectionLabel}>{t('editor.experiences.flashcards.mode_label', 'Learners start in')}</span>
                <Segmented<GridMode>
                  ariaLabel={t('editor.experiences.flashcards.mode_label', 'Learners start in')}
                  value={deck.mode}
                  onChange={(v) => props.updateAttributes({ mode: v })}
                  options={[
                    { value: 'grid', label: t('activities.experiences.flashcards.view_grid', 'Grid') },
                    { value: 'study', label: t('activities.experiences.flashcards.view_study', 'Study') },
                  ]}
                />
                <span className="text-[11px] leading-snug text-neutral-400">{t('editor.experiences.flashcards.mode_hint', 'Learners can always switch between the two.')}</span>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={deck.shuffle}
                  onChange={(e) => props.updateAttributes({ shuffle: e.target.checked })}
                  className="mt-0.5 h-4 w-4 flex-none accent-neutral-900"
                />
                <span className="flex flex-col">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-800">
                    <Shuffle size={13} />
                    {t('editor.experiences.flashcards.shuffle', 'Shuffle cards')}
                  </span>
                  <span className="text-[11px] leading-snug text-neutral-400">{t('editor.experiences.flashcards.shuffle_hint', 'Each learner sees the cards in a new order.')}</span>
                </span>
              </label>
              <div aria-hidden className="h-px bg-neutral-100" />
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false)
                    setPasteOpen(true)
                  }}
                  className={buttonClass('secondary', 'sm')}
                >
                  <ClipboardText size={13} weight="duotone" />
                  {t('editor.experiences.flashcards.paste_title', 'Paste a list')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const pos = gridPos()
                    setSettingsOpen(false)
                    if (typeof pos === 'number') ungroupGrid(props.editor, pos)
                  }}
                  className={buttonClass('secondary', 'sm')}
                >
                  <Rows size={13} weight="duotone" />
                  {t('activities.ungroup_cards')}
                </button>
              </div>
            </BlockPopover>
          </div>
        </div>

        {/* The column count rides a CSS variable rather than a Tailwind class:
            Tiptap injects its own content holder inside the content element, so
            the grid is declared in CSS where that holder can be dissolved. The
            "+ Add card" ghost is the grid's last cell. */}
        <div className={panel !== 'cards' ? 'hidden' : undefined}>
        <div className="flipcard-grid-content flipcard-grid-edit">
          <NodeViewContent className="flipcard-grid-holder" />
          <button
            type="button"
            contentEditable={false}
            onClick={addCard}
            className="flex h-48 w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-neutral-200 text-[13px] font-medium text-neutral-500 outline-none transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500/40 max-md:h-36"
          >
            <Plus size={14} weight="bold" aria-hidden />
            {t('activities.add_card')}
          </button>
        </div>
        </div>

        {panel === 'list' && (
          <>
            <ListEditor
              cards={cards}
              onChange={(i, patch) => {
                const pos = gridPos()
                if (typeof pos === 'number') updateCardAttrs(props.editor, pos, i, patch)
              }}
              onDelete={(i) => {
                const pos = gridPos()
                if (typeof pos === 'number') deleteCard(props.editor, pos, i)
              }}
            />
            <div className="mt-2 flex flex-wrap gap-1.5" contentEditable={false}>
              <button type="button" onClick={addCard} className={buttonClass('secondary', 'sm')}>
                <Plus size={12} weight="bold" />
                {t('activities.add_card')}
              </button>
              <button type="button" onClick={() => setPasteOpen(true)} className={buttonClass('secondary', 'sm')}>
                <ClipboardText size={13} weight="duotone" />
                {t('editor.experiences.flashcards.paste_title', 'Paste a list')}
              </button>
            </div>
          </>
        )}
        {preview && (
          <div className="lh-exp-frame rounded-2xl bg-white p-3 shadow-[0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04)] sm:p-4" contentEditable={false}>
            <FlashcardStudy cards={cards} shuffle={deck.shuffle} memorySource="editor-preview" />
          </div>
        )}

        <BlockPopover
          open={pasteOpen}
          onOpenChange={setPasteOpen}
          align="center"
          width={320}
          title={t('editor.experiences.flashcards.paste_title', 'Paste a list')}
          trigger={<span aria-hidden className="block h-0 w-full" />}
        >
          <PasteForm onAdd={paste} />
        </BlockPopover>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

/** Question | answer rows; edits each card in place (one step per field). */
function ListEditor({
  cards,
  onChange,
  onDelete,
}: {
  cards: StudyDeckCard[]
  onChange: (_i: number, _patch: { question?: string; answer?: string }) => void
  onDelete: (_i: number) => void
}) {
  const { t } = useTranslation()
  const field =
    'min-h-8 w-full rounded-lg bg-white px-2.5 py-1.5 text-[13px] leading-snug text-neutral-800 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none placeholder:text-neutral-400 focus:shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_0_3px_rgba(14,165,233,0.12)]'
  return (
    <div contentEditable={false} className="rounded-xl bg-neutral-50 p-2 ring-1 ring-neutral-200/70 sm:p-3" data-testid="flashcards-list">
      <div className="mb-1.5 hidden grid-cols-[1.75rem_1fr_1fr_1.75rem] gap-2 px-0.5 text-[12px] font-medium text-neutral-500 sm:grid">
        <span />
        <span>{t('editor.experiences.flashcards.question', 'Question')}</span>
        <span>{t('editor.experiences.flashcards.answer', 'Answer')}</span>
        <span />
      </div>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {cards.map((card, i) => (
          <li key={`${i}:${card.key}`} className="grid grid-cols-[1.75rem_1fr_1.75rem] items-start gap-2 sm:grid-cols-[1.75rem_1fr_1fr_1.75rem]">
            <span aria-hidden className="mt-1.5 flex h-5 items-center justify-center text-[11px] font-semibold tabular-nums text-neutral-400">
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5 sm:contents">
              <DraftText
                value={card.question}
                maxLength={2000}
                placeholder={t('activities.enter_question')}
                ariaLabel={t('editor.experiences.flashcards.question_n', { n: i + 1, defaultValue: 'Question {{n}}' })}
                onCommit={(v) => onChange(i, { question: v })}
                className={field}
              />
              <DraftText
                value={card.answer}
                maxLength={2000}
                placeholder={t('activities.enter_answer')}
                ariaLabel={t('editor.experiences.flashcards.answer_n', { n: i + 1, defaultValue: 'Answer {{n}}' })}
                onCommit={(v) => onChange(i, { answer: v })}
                className={field}
              />
            </div>
            <button
              type="button"
              onClick={() => onDelete(i)}
              aria-label={t('editor.blocks_v2.flipcard.delete_card', 'Delete card')}
              title={t('editor.blocks_v2.flipcard.delete_card', 'Delete card')}
              className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
            >
              <Trash size={13} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Bulk add: one "term – definition" (or "term: definition") per line. */
function PasteForm({ onAdd }: { onAdd: (_rows: { question: string; answer: string }[]) => void }) {
  const { t } = useTranslation()
  const [text, setText] = React.useState('')
  const rows = React.useMemo(() => parseBulkCards(text), [text])
  return (
    <>
      <p className="m-0 text-[12px] leading-snug text-neutral-500">
        {t('editor.experiences.flashcards.paste_hint', 'One card per line: term – definition, or term: definition.')}
      </p>
      <textarea
        value={text}
        rows={6}
        dir="auto"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={t('editor.experiences.flashcards.paste_title', 'Paste a list')}
        placeholder={t('editor.experiences.flashcards.paste_placeholder', 'Photosynthesis – how plants make food\nMitosis: cell division')}
        className={TEXTAREA_CLASS}
      />
      <div className="flex items-center gap-2">
        <span className="text-[12px] tabular-nums text-neutral-500">
          {rows.length
            ? t('editor.experiences.flashcards.paste_found', { count: rows.length, defaultValue: 'Cards found: {{count}}' })
            : t('editor.experiences.flashcards.paste_none', 'No cards found yet.')}
        </span>
        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() => {
            onAdd(rows)
            setText('')
          }}
          className={buttonClass('primary', 'sm', 'ms-auto')}
        >
          <Plus size={12} weight="bold" />
          {t('editor.experiences.flashcards.paste_add', 'Add cards')}
        </button>
      </div>
    </>
  )
}

export default FlipcardGridExtension
