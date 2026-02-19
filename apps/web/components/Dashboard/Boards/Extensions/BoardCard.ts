import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import BoardCardComponent from './BoardCardComponent'

export const BoardCardExtension = Node.create({
  name: 'boardCard',
  group: 'block',
  content: 'block+',
  draggable: true,
  defining: true,

  addAttributes() {
    return {
      x: { default: 100 },
      y: { default: 100 },
      width: { default: 300 },
      height: { default: 200 },
      color: { default: '#ffffff' },
      zIndex: { default: 1 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="board-card"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'board-card' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BoardCardComponent)
  },
})
