import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import EmbedBlockComponent from './EmbedBlockComponent'

export const EmbedBlockExtension = Node.create({
  name: 'embedBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      embedUrl: { default: '' },
      embedCode: { default: '' },
      embedType: { default: 'url' },
      x: { default: 100 },
      y: { default: 100 },
      width: { default: 520 },
      height: { default: 360 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="embed-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedBlockComponent)
  },
})
