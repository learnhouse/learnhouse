import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import React, { lazy, Suspense } from 'react'
const Picker = lazy(() => import('@emoji-mart/react'))
import { Palette, Smiley, SquaresFour } from '@phosphor-icons/react'
import { BlockPopover, BlockToolbarButton } from '../../Blocks/ui/BlockChrome'
import { twMerge } from 'tailwind-merge'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'
import { useColorScheme } from '@components/Contexts/ColorSchemeContext'

const BadgesExtension: React.FC = (props: any) => {
  const { t } = useTranslation()
  const { colorScheme } = useColorScheme()
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable
  // Read from node attrs so undo and collaborators' changes show.
  const color: string = props.node.attrs.color
  const emoji: string = props.node.attrs.emoji
  const [open, setOpen] = React.useState<null | 'emoji' | 'color' | 'presets'>(null)
  const pop = (which: 'emoji' | 'color' | 'presets') => (o: boolean) => setOpen(o ? which : null)

  const handlePredefinedBadgeSelect = (badge: { emoji: string; color: string; content: string }) => {
    const pos = props.getPos()
    if (typeof pos !== 'number') return
    // One transaction: attrs and label together (undoes in one step).
    props.editor
      .chain()
      .focus()
      .command(({ tr }: any) => {
        tr.setNodeMarkup(pos, undefined, { ...props.node.attrs, emoji: badge.emoji, color: badge.color })
        tr.replaceWith(pos + 1, pos + props.node.nodeSize - 1, props.editor.schema.text(badge.content))
        return true
      })
      .run()
    setOpen(null)
  }

  const colors = ['sky', 'green', 'yellow', 'red', 'purple', 'teal', 'amber', 'indigo', 'neutral']
  const predefinedBadges = [
    {
      emoji: '📝',
      color: 'sky',
      content: 'Key Concept'
    },
    {
      emoji: '💡',
      color: 'yellow',
      content: 'Example'
    },
    {
      emoji: '🔍',
      color: 'teal',
      content: 'Deep Dive'
    },
    {
      emoji: '⚠️',
      color: 'red',
      content: 'Important Note'
    },
    {
      emoji: '🧠',
      color: 'purple',
      content: 'Remember This'
    },
    {
      emoji: '🏋️',
      color: 'green',
      content: 'Exercise'
    },
    {
      emoji: '🎯',
      color: 'amber',
      content: 'Learning Objective'
    },
    {
      emoji: '📚',
      color: 'indigo',
      content: 'Further Reading'
    },
    {
      emoji: '💬',
      color: 'neutral',
      content: 'Discussion Topic'
    }
  ]

  const getBadgeColor = (color: string) => {
    switch (color) {
      case 'sky': return 'bg-sky-400 text-sky-50';
      case 'green': return 'bg-green-400 text-green-50';
      case 'yellow': return 'bg-yellow-400 text-black';
      case 'red': return 'bg-red-500 text-red-50';
      case 'purple': return 'bg-purple-400 text-purple-50';
      case 'pink': return 'bg-pink-400 text-pink-50';
      case 'teal': return 'bg-teal-400 text-teal-900';
      case 'amber': return 'bg-amber-600 text-amber-100';
      case 'indigo': return 'bg-indigo-400 text-indigo-50';
      case 'neutral': return 'bg-neutral-800 text-white';
      default: return 'bg-sky-400 text-white';
    }
  }


  const pill = (
    <div data-lhb-keep="" className={twMerge(
      'flex space-x-1 py-1.5 items-center w-fit rounded-full outline outline-2 outline-white/20 px-3.5 font-semibold nice-shadow text-sm my-2',
      getBadgeColor(color)
    )}>
      <span className='text' contentEditable={false}>{emoji}</span>
      <NodeViewContent className="content capitalize text tracking-wide min-w-[2ch]" />
    </div>
  )

  if (!isEditable) return <NodeViewWrapper><div className='flex space-x-2 items-center relative'>{pill}</div></NodeViewWrapper>

  const tools = (
    <>
      <BlockPopover
        open={open === 'presets'}
        onOpenChange={pop('presets')}
        title={t('editor.blocks_v2.badge.presets', 'Presets')}
        width={320}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.badge.presets', 'Presets')}><SquaresFour size={14} /></BlockToolbarButton>}
      >
        <div className="flex flex-wrap gap-1.5">
          {predefinedBadges.map((badge) => (
            <button
              key={badge.content}
              type="button"
              onClick={() => handlePredefinedBadgeSelect(badge)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${getBadgeColor(badge.color)} hover:opacity-90`}
            >
              <span>{badge.emoji}</span>
              <span className="capitalize">{badge.content}</span>
            </button>
          ))}
        </div>
      </BlockPopover>
      <BlockPopover
        open={open === 'emoji'}
        onOpenChange={pop('emoji')}
        width={360}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.button.emoji', 'Emoji')}><Smiley size={14} /></BlockToolbarButton>}
      >
        <Suspense fallback={<div className="p-4 text-gray-400 text-sm">{t('common.loading')}</div>}>
          <Picker searchPosition="top" theme={colorScheme} previewPosition="none" maxFrequentRows={0} autoFocus={false} onEmojiSelect={(e: any) => { props.updateAttributes({ emoji: e.native }); setOpen(null) }} />
        </Suspense>
      </BlockPopover>
      <BlockPopover
        open={open === 'color'}
        onOpenChange={pop('color')}
        title={t('editor.blocks_v2.color', 'Color')}
        width={232}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.color', 'Color')}><Palette size={14} /></BlockToolbarButton>}
      >
        <div className="grid grid-cols-5 gap-2">
          {colors.map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={c === color} onClick={() => props.updateAttributes({ color: c })} className={`h-8 w-8 rounded-full ${getBadgeColor(c)} ${c === color ? 'ring-2 ring-neutral-900 ring-offset-2' : ''}`} />
          ))}
        </div>
      </BlockPopover>
    </>
  )

  return (
    <NodeViewWrapper>
      <EditorBlockFrame editable node={props.node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="neutral" editableContent tools={tools} className="px-2">
        {pill}
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default BadgesExtension
