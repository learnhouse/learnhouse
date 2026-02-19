import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import StickyNoteComponent from './StickyNoteComponent'

export const StickyNoteExtension = Node.create({
  name: 'stickyNote',
  group: 'block',
  content: 'block+',
  draggable: true,

  addAttributes() {
    return {
      x: { default: 100 },
      y: { default: 100 },
      color: { default: 'yellow' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="sticky-note"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'sticky-note' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(StickyNoteComponent)
  },
})
