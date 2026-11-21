'use client'
/*
 Quote block: a pull quote, a testimonial card or a highlighted passage.
 The quote itself is ordinary paragraphs (editable text that old clients
 keep); the author, role and avatar are attrs shown in the caption.
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Quotes, SlidersHorizontal } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, CommitInput, Segmented, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import { oneOf, QUOTE_VARIANTS, safeUrl } from '../mediaModel'
import { QUOTE_FRAME as FRAME, QUOTE_TEXT as TEXT, initials } from './quoteStyles'
import { commitAttrs, InlineInput, useIsEditable } from './shared'

export default function QuoteBlockView(props: NodeViewProps) {
  const { t } = useTranslation()
  const isEditable = useIsEditable()
  const { node } = props
  const variant = oneOf(QUOTE_VARIANTS, node.attrs.variant, 'pull')
  const author: string = typeof node.attrs.author === 'string' ? node.attrs.author : ''
  const role: string = typeof node.attrs.role === 'string' ? node.attrs.role : ''
  const avatar = safeUrl(node.attrs.avatarUrl)
  const [open, setOpen] = React.useState(false)
  // The photo link that failed to load (a new link gets a new try).
  const [failedAvatar, setFailedAvatar] = React.useState<string | null>(null)
  const avatarFailed = !!avatar && failedAvatar === avatar
  const set = (attrs: Record<string, unknown>) => commitAttrs(props, attrs)

  const tools = (
    <BlockPopover
      open={open}
      onOpenChange={setOpen}
      title={t('editor.blocks_v2.quote_block.label', 'Quote')}
      trigger={
        <BlockToolbarButton label={t('editor.blocks_v2.quote_block.settings', 'Quote settings')} active={open}>
          <SlidersHorizontal size={14} />
        </BlockToolbarButton>
      }
    >
      <SettingsField label={t('editor.blocks_v2.quote_block.style', 'Style')}>
        <Segmented
          ariaLabel={t('editor.blocks_v2.quote_block.style', 'Style')}
          value={variant}
          onChange={(v) => set({ variant: v })}
          options={[
            { value: 'pull', label: t('editor.blocks_v2.quote_block.variant_pull', 'Pull quote') },
            { value: 'testimonial', label: t('editor.blocks_v2.quote_block.variant_testimonial', 'Testimonial') },
            { value: 'highlight', label: t('editor.blocks_v2.quote_block.variant_highlight', 'Highlight') },
          ]}
        />
      </SettingsField>
      <SettingsField label={t('editor.blocks_v2.quote_block.avatar', 'Photo link')} hint={t('editor.blocks_v2.quote_block.avatar_hint', 'Shown next to the name on testimonials. Leave empty for initials.')}>
        <CommitInput
          type="url"
          value={avatar ?? ''}
          placeholder="https://"
          aria-label={t('editor.blocks_v2.quote_block.avatar', 'Photo link')}
          onCommit={(v) => set({ avatarUrl: safeUrl(v) })}
        />
      </SettingsField>
    </BlockPopover>
  )

  const fieldClass = 'min-w-0 bg-transparent outline-none placeholder:text-neutral-400'
  const authorField = isEditable ? (
    <InlineInput
      value={author}
      maxLength={120}
      onCommit={(v) => set({ author: v.trim() || null })}
      placeholder={t('editor.blocks_v2.quote_block.author_placeholder', 'Name')}
      aria-label={t('editor.blocks_v2.quote_block.author', 'Author')}
      className={cn(fieldClass, 'font-semibold text-neutral-900', variant === 'pull' ? 'text-center' : '')}
      size={Math.max(6, author.length + 1)}
    />
  ) : author ? (
    <cite className="font-semibold not-italic text-neutral-900">{author}</cite>
  ) : null
  const roleField = isEditable ? (
    <InlineInput
      value={role}
      maxLength={120}
      onCommit={(v) => set({ role: v.trim() || null })}
      placeholder={t('editor.blocks_v2.quote_block.role_placeholder', 'Role or company')}
      aria-label={t('editor.blocks_v2.quote_block.role', 'Role')}
      className={cn(fieldClass, 'text-neutral-500', variant === 'pull' ? 'text-center' : '')}
      size={Math.max(10, role.length + 1)}
    />
  ) : role ? (
    <span className="text-neutral-500">{role}</span>
  ) : null
  const hasCaption = isEditable || author || role

  const caption = hasCaption ? (
    <figcaption contentEditable={false} className={cn('mt-3 flex items-center gap-3 text-sm', variant === 'pull' ? 'justify-center' : '')}>
      {variant === 'testimonial' &&
        (avatar && !avatarFailed ? (
          <img src={avatar} alt="" className="h-10 w-10 flex-none rounded-full object-cover ring-1 ring-black/5" onError={() => setFailedAvatar(avatar)} />
        ) : author ? (
          <span aria-hidden className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
            {initials(author)}
          </span>
        ) : null)}
      <span className={cn('flex min-w-0 flex-wrap items-baseline gap-x-1.5', variant === 'testimonial' ? 'flex-col items-start gap-y-0' : '', variant === 'pull' ? 'justify-center' : '')}>
        {variant !== 'testimonial' && (author || isEditable) && <span aria-hidden className="text-neutral-400">—</span>}
        {authorField}
        {roleField}
      </span>
    </figcaption>
  ) : null

  return (
    <NodeViewWrapper className="lh-quote-block my-5" data-variant={variant}>
      <EditorBlockFrame
        editable={isEditable}
        node={node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="info"
        label={
          <>
            <Quotes size={11} weight="bold" />
            {t('editor.blocks_v2.quote_block.label', 'Quote')}
          </>
        }
        tools={tools}
        editableContent
        forceToolbar={open}
      >
        <figure className={cn('m-0', FRAME[variant])}>
          {variant !== 'highlight' && (
            <span aria-hidden contentEditable={false} className={cn('mb-2 flex text-violet-500/80', variant === 'pull' ? 'justify-center' : '')}>
              <Quotes weight="fill" size={variant === 'pull' ? 30 : 22} />
            </span>
          )}
          <blockquote className={cn('m-0 border-0 p-0', TEXT[variant])}>
            <NodeViewContent className="lh-quote-body" />
          </blockquote>
          {caption}
        </figure>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}
