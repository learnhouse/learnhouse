import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import TodoBlockComponent from './TodoBlockComponent'

export const TodoBlockExtension = Node.create({
  name: 'todoBlock',
  group: 'block',
  draggable: true,
  defining: true,
  atom: true,

  addAttributes() {
    return {
      x: { default: 100 },
      y: { default: 100 },
      width: { default: 260 },
      height: { default: 260 },
      color: { default: 'blue' },
      zIndex: { default: 1 },
      title: { default: 'To-do' },
      items: { default: [] },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="todo-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'todo-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TodoBlockComponent)
  },
})
