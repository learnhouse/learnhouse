import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, CommitInput, Segmented, SettingsField } from '../../Blocks/ui/BlockChrome'
import { safeHref } from '@services/security/url'
import React, { lazy, Suspense } from 'react'
const Picker = lazy(() => import('@emoji-mart/react'))
import { ArrowRight, Link, TextAlignLeft, TextAlignCenter, TextAlignRight, Palette, Smiley, Sliders } from '@phosphor-icons/react'
import { twMerge } from 'tailwind-merge'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'
import { normalizeUserUrl } from '../../Blocks/embeds/embedProviders'
import { BUTTON_SIZES, BUTTON_VARIANTS, buttonSizeOf, buttonVariantOf, type ButtonSize, type ButtonVariant } from '../../Blocks/schema/blockAttrs'
import { BUTTON_COLORS as COLORS, buttonFaceClasses, solidColorClasses as getButtonColor } from './buttonStyles'

const alignClass = (alignment: string) => (alignment === 'center' ? 'text-center' : alignment === 'right' ? 'text-end' : 'text-start')

/*
 Call-to-action button. Every setting reads from and writes to node attrs
 (collab-safe, undoable); the link is written once on blur/Enter. In the
 editor the label is plain editable text (the old <button> wrapper with
 pointer-events-none made it impossible to click into the label).
*/
const ButtonsExtension: React.FC = (props: any) => {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable
  const { emoji, link, alignment = 'left' } = props.node.attrs
  const color: string = props.node.attrs.color || 'blue'
  const variant = buttonVariantOf(props.node.attrs)
  const size = buttonSizeOf(props.node.attrs)
  const face = buttonFaceClasses(color, variant, size)
  const [open, setOpen] = React.useState<null | 'emoji' | 'link' | 'color' | 'style'>(null)
  const pop = (which: 'emoji' | 'link' | 'color' | 'style') => (o: boolean) => setOpen(o ? which : null)

  if (!isEditable) {
    return (
      <NodeViewWrapper className={`block-button ${alignClass(alignment)}`}>
        <div className="inline-block">
          <button
            data-lhb-keep=""
            onClick={() => { const safe = safeHref(link); if (safe !== '#') window.open(safe, '_blank', 'noopener,noreferrer') }}
            className={twMerge('flex items-center space-x-2 transition-colors', face, !link && 'opacity-60')}
          >
            <span>{emoji}</span>
            <NodeViewContent className="content" />
            <ArrowRight weight="duotone" size={14} data-dir-flip />
          </button>
        </div>
      </NodeViewWrapper>
    )
  }

  const tools = (
    <>
      <BlockPopover
        open={open === 'emoji'}
        onOpenChange={pop('emoji')}
        width={360}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.button.emoji', 'Emoji')}><Smiley size={14} /></BlockToolbarButton>}
      >
        <Suspense fallback={<div className="p-4 text-sm text-neutral-400">{t('common.loading')}</div>}>
          <Picker onEmojiSelect={(e: any) => { props.updateAttributes({ emoji: e.native }); setOpen(null) }} />
        </Suspense>
      </BlockPopover>
      <BlockPopover
        open={open === 'link'}
        onOpenChange={pop('link')}
        title={t('editor.blocks_v2.link', 'Link')}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.link', 'Link')} active={!!link}><Link size={14} /></BlockToolbarButton>}
      >
        <SettingsField label={t('editor.blocks.button_block.enter_link_url', 'Link URL')} hint={t('editor.blocks_v2.button.link_hint', 'Opens in a new tab when learners click the button.')}>
          <CommitInput
            value={link || ''}
            type="url"
            placeholder="https://"
            aria-label={t('editor.blocks_v2.link', 'Link')}
            onCommit={(v) => props.updateAttributes({ link: v.trim() ? normalizeUserUrl(v) || v.trim() : '' })}
          />
        </SettingsField>
      </BlockPopover>
      <BlockPopover
        open={open === 'color'}
        onOpenChange={pop('color')}
        title={t('editor.blocks_v2.color', 'Color')}
        width={232}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.color', 'Color')}><Palette size={14} /></BlockToolbarButton>}
      >
        <div className="grid grid-cols-5 gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={c === color}
              onClick={() => props.updateAttributes({ color: c })}
              className={`h-8 w-8 rounded-full ${getButtonColor(c)} ${c === color ? 'ring-2 ring-neutral-900 ring-offset-2' : ''}`}
            />
          ))}
        </div>
      </BlockPopover>
      <BlockPopover
        open={open === 'style'}
        onOpenChange={pop('style')}
        title={t('editor.blocks_v2.button.style', 'Style')}
        width={280}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.button.style', 'Style')}><Sliders size={14} /></BlockToolbarButton>}
      >
        <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-neutral-600">{t('editor.blocks_v2.button.variant', 'Look')}</span>
          <Segmented<ButtonVariant>
            ariaLabel={t('editor.blocks_v2.button.variant', 'Look')}
            value={variant}
            onChange={(v) => props.updateAttributes({ variant: v === 'solid' ? null : v })}
            options={BUTTON_VARIANTS.map((v) => ({ value: v, label: t(`editor.blocks_v2.button.variant_${v}`, v.charAt(0).toUpperCase() + v.slice(1)) }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-neutral-600">{t('editor.blocks_v2.button.size', 'Size')}</span>
          <Segmented<ButtonSize>
            ariaLabel={t('editor.blocks_v2.button.size', 'Size')}
            value={size}
            onChange={(v) => props.updateAttributes({ size: v === 'md' ? null : v })}
            options={BUTTON_SIZES.map((v) => ({
              value: v,
              label: { sm: 'S', md: 'M', lg: 'L' }[v],
              title: t(`editor.blocks.common.${v === 'sm' ? 'small' : v === 'md' ? 'medium' : 'large'}`),
            }))}
          />
        </div>
      </BlockPopover>
      {(['left', 'center', 'right'] as const).map((a) => (
        <BlockToolbarButton
          key={a}
          label={t(`editor.blocks.common.align_${a}`)}
          active={alignment === a}
          onClick={() => props.updateAttributes({ alignment: a })}
        >
          {a === 'left' ? <TextAlignLeft size={14} /> : a === 'center' ? <TextAlignCenter size={14} /> : <TextAlignRight size={14} />}
        </BlockToolbarButton>
      ))}
    </>
  )

  return (
    <NodeViewWrapper className={`block-button ${alignClass(alignment)}`}>
      <EditorBlockFrame
        editable
        node={props.node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="interactive"
        editableContent
        tools={tools}
        className="px-2 pb-2 pt-3"
      >
        <div className="inline-flex flex-col items-start gap-1">
          <div className={twMerge('inline-flex items-center gap-2', face)}>
            <span contentEditable={false}>{emoji}</span>
            <NodeViewContent className="content min-w-[2ch] outline-none" />
            <span contentEditable={false} className="flex"><ArrowRight weight="duotone" size={14} data-dir-flip /></span>
          </div>
          <span contentEditable={false} className="text-[11px] text-neutral-400">
            {link ? safeHref(link) : t('editor.blocks_v2.button.no_link', 'No link yet: set one with the link button.')}
          </span>
        </div>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default ButtonsExtension
