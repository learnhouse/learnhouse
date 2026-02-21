import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import StickerBlockComponent from './StickerBlockComponent'

export const StickerBlockExtension = Node.create({
  name: 'stickerBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      x: { default: 100 },
      y: { default: 100 },
      emoji: { default: '😀' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="sticker-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'sticker-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(StickerBlockComponent)
  },
})
