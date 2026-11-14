import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, CommitInput, SettingsField } from '../../Blocks/ui/BlockChrome'
import { safeHref } from '@services/security/url'
import React, { lazy, Suspense } from 'react'
const Picker = lazy(() => import('@emoji-mart/react'))
import { ArrowRight, Link, TextAlignLeft, TextAlignCenter, TextAlignRight, Palette, Smiley } from '@phosphor-icons/react'
import { twMerge } from 'tailwind-merge'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'
import { normalizeUserUrl } from '../../Blocks/embeds/embedProviders'

const COLORS = ['blue', 'sky', 'indigo', 'purple', 'teal', 'green', 'amber', 'yellow', 'red', 'neutral'] as const

const getButtonColor = (color: string) => {
  switch (color) {
    case 'sky': return 'bg-sky-500 hover:bg-sky-600'
    case 'green': return 'bg-green-500 hover:bg-green-600'
    case 'yellow': return 'bg-yellow-500 hover:bg-yellow-600'
    case 'red': return 'bg-red-500 hover:bg-red-600'
    case 'purple': return 'bg-purple-500 hover:bg-purple-600'
    case 'teal': return 'bg-teal-500 hover:bg-teal-600'
    case 'amber': return 'bg-amber-500 hover:bg-amber-600'
    case 'indigo': return 'bg-indigo-500 hover:bg-indigo-600'
    case 'neutral': return 'bg-neutral-500 hover:bg-neutral-600'
    default: return 'bg-blue-500 hover:bg-blue-600'
  }
}

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
  const [open, setOpen] = React.useState<null | 'emoji' | 'link' | 'color'>(null)
  const pop = (which: 'emoji' | 'link' | 'color') => (o: boolean) => setOpen(o ? which : null)

  if (!isEditable) {
    return (
      <NodeViewWrapper className={`block-button ${alignClass(alignment)}`}>
        <div className="inline-block">
          <button
            data-lhb-keep=""
            onClick={() => { const safe = safeHref(link); if (safe !== '#') window.open(safe, '_blank', 'noopener,noreferrer') }}
            className={twMerge('flex items-center space-x-2 py-2 px-4 rounded-xl text-white transition-colors', getButtonColor(color), !link && 'opacity-60')}
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
          <div className={twMerge('inline-flex items-center gap-2 rounded-xl px-4 py-2 text-white', getButtonColor(color))}>
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
