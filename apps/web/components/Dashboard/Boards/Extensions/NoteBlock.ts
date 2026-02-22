import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import NoteBlockComponent from './NoteBlockComponent'

export const NoteBlockExtension = Node.create({
  name: 'noteBlock',
  group: 'block',
  content: 'block+',
  draggable: true,
  defining: true,

  addAttributes() {
    return {
      x: { default: 100 },
      y: { default: 100 },
      width: { default: 260 },
      height: { default: 200 },
      color: { default: 'yellow' },
      zIndex: { default: 1 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="note-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'note-block' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteBlockComponent)
  },
})
