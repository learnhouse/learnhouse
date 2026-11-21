'use client'
/*
 The shared card every Experiences block renders in.

 Header: tone-colored icon chip, the block title (editable while authoring),
 an optional one-line instruction for learners and, while authoring, the
 "Preview as learner" toggle. Then the body, then an optional footer
 (usually <ExperienceFooter/>). A polite live region announces `live`
 (feedback such as "Correct!") to screen readers, and `celebrate` plays the
 completion burst.

 While authoring (`editable`) the card sits inside EditorBlockFrame (selection
 ring, hover label, Duplicate/Delete toolbar) when `nodeView` is passed.
 The block's own NodeViewWrapper stays in the block view.
*/
import React from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { Eye, PencilSimple } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import EditorBlockFrame from '../../../Blocks/ui/EditorBlockFrame'
import { BLOCK_TONE, type BlockTone } from '../../../Blocks/ui/BlockChrome'
import DraftText from '../../../Blocks/ui/DraftText'
import { cn } from '@/lib/utils'
import { Celebrate } from './Celebrate'
import { InlineText } from './InlineText'

export interface ExperienceFrameProps {
  tone: BlockTone
  /** A phosphor icon element, e.g. <Cards weight="duotone" />. Sized by the frame. */
  icon: React.ReactNode
  title: string
  onTitleChange?: (_title: string) => void
  titlePlaceholder?: string
  instructions?: string
  /** Makes the instruction line editable while authoring. */
  onInstructionsChange?: (_value: string) => void
  instructionsPlaceholder?: string
  editable: boolean
  /** Authoring only: show the learner view instead of the form. */
  preview?: boolean
  onPreviewChange?: (_preview: boolean) => void
  footer?: React.ReactNode
  children: React.ReactNode
  /** Node view props: wraps the card in EditorBlockFrame while authoring. */
  nodeView?: Pick<NodeViewProps, 'node' | 'editor' | 'getPos' | 'selected'>
  /** Hover label in the editor (defaults to the title). */
  label?: React.ReactNode
  /** Extra buttons for the block's floating editor toolbar. */
  tools?: React.ReactNode
  /** Extra controls at the end of the header (both modes). */
  headerEnd?: React.ReactNode
  /** Plays the completion burst on its rising edge. */
  celebrate?: boolean
  /** Feedback text announced politely to screen readers. */
  live?: string
  className?: string
  bodyClassName?: string
  /**
   * Edit in place: while authoring, the body keeps the learner's table
   * surface and spacing, and the title / instructions use InlineText.
   */
  wysiwyg?: boolean
}

export function ExperienceFrame({
  tone,
  icon,
  title,
  onTitleChange,
  titlePlaceholder,
  instructions,
  onInstructionsChange,
  instructionsPlaceholder,
  editable,
  preview = false,
  onPreviewChange,
  footer,
  children,
  nodeView,
  label,
  tools,
  headerEnd,
  celebrate = false,
  live,
  className,
  bodyClassName,
  wysiwyg = false,
}: ExperienceFrameProps) {
  const { t } = useTranslation()
  const authoring = editable && !preview
  const toneClass = BLOCK_TONE[tone] ?? BLOCK_TONE.neutral

  const card = (
    <section
      data-experience=""
      data-tone={tone}
      data-preview={editable && preview ? 'true' : undefined}
      aria-label={title || undefined}
      className={cn(
        'lh-exp-frame relative isolate my-3 w-full min-w-0 overflow-hidden rounded-2xl bg-white text-start shadow-[0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_6px_18px_-12px_rgba(15,23,42,0.1)]',
        editable && preview && 'outline-2 outline-offset-2 outline-dashed outline-sky-300',
        className,
      )}
    >
      <header className="flex items-center gap-3 px-4 pt-4 sm:px-5">
        <span
          aria-hidden
          className={cn('lh-exp-icon inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl [&>svg]:h-5 [&>svg]:w-5', toneClass.soft)}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          {authoring && onTitleChange && wysiwyg ? (
            <InlineText
              value={title}
              onCommit={onTitleChange}
              maxLength={120}
              placeholder={titlePlaceholder ?? t('editor.experiences.common.title_placeholder', 'Block title')}
              ariaLabel={t('editor.experiences.common.title_label', 'Title')}
              className="text-[15px] leading-snug font-semibold text-neutral-900"
            />
          ) : authoring && onTitleChange ? (
            <DraftText
              value={title}
              onCommit={onTitleChange}
              multiline={false}
              maxLength={120}
              placeholder={titlePlaceholder ?? t('editor.experiences.common.title_placeholder', 'Block title')}
              ariaLabel={t('editor.experiences.common.title_label', 'Title')}
              className="text-[15px] leading-snug font-semibold text-neutral-900"
            />
          ) : (
            title && <h3 className="m-0 text-[15px] leading-snug font-semibold text-neutral-900 [overflow-wrap:anywhere]">{title}</h3>
          )}
          {authoring && onInstructionsChange && wysiwyg ? (
            <InlineText
              value={instructions ?? ''}
              onCommit={onInstructionsChange}
              maxLength={240}
              placeholder={instructionsPlaceholder ?? t('editor.experiences.common.instructions_placeholder', 'One line telling learners what to do')}
              ariaLabel={t('editor.experiences.common.instructions_label', 'Instructions')}
              className="mt-0.5 text-[13px] leading-relaxed text-neutral-500"
            />
          ) : authoring && onInstructionsChange ? (
            <DraftText
              value={instructions ?? ''}
              onCommit={onInstructionsChange}
              multiline={false}
              maxLength={240}
              placeholder={instructionsPlaceholder ?? t('editor.experiences.common.instructions_placeholder', 'One line telling learners what to do')}
              ariaLabel={t('editor.experiences.common.instructions_label', 'Instructions')}
              className="mt-0.5 text-[13px] leading-relaxed text-neutral-500"
            />
          ) : (
            instructions && <p className="m-0 mt-0.5 text-[13px] leading-relaxed text-neutral-500 [overflow-wrap:anywhere]">{instructions}</p>
          )}
        </div>
        {headerEnd}
        {editable && onPreviewChange && (
          <button
            type="button"
            aria-pressed={preview}
            onClick={() => onPreviewChange(!preview)}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
              preview ? 'bg-neutral-900 text-white hover:bg-neutral-800' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900',
            )}
          >
            {preview ? <PencilSimple size={13} weight="bold" aria-hidden /> : <Eye size={13} weight="bold" aria-hidden />}
            <span className="hidden sm:inline">
              {preview ? t('editor.experiences.common.back_to_editing', 'Back to editing') : t('editor.experiences.common.preview_as_learner', 'Preview as learner')}
            </span>
            <span className="sm:hidden">
              {preview ? t('editor.experiences.common.edit', 'Edit') : t('editor.experiences.common.preview', 'Preview')}
            </span>
          </button>
        )}
      </header>
      <div
        className={cn(
          'lh-exp-body',
          authoring && !wysiwyg ? 'px-4 pt-3 pb-4 sm:px-5' : 'lh-exp-table mx-3 mt-3 mb-3 px-3 py-4 sm:mx-4 sm:px-4 sm:py-5',
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {live ?? ''}
      </div>
      <Celebrate show={celebrate} />
    </section>
  )

  if (editable && nodeView) {
    return (
      <EditorBlockFrame
        editable
        node={nodeView.node}
        editor={nodeView.editor}
        getPos={nodeView.getPos}
        selected={nodeView.selected}
        tone={tone}
        label={label ?? title}
        tools={tools}
      >
        {card}
      </EditorBlockFrame>
    )
  }
  return card
}

export default ExperienceFrame
