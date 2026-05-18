import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ButtonsComponent from './ButtonsComponent'

export const Buttons = Node.create({
  name: 'button',
  group: 'block',
  draggable: false,
  content: 'text*',
  addAttributes() {
    return {
      emoji: { default: '🔗' },
      link: { default: '' },
      color: { default: 'blue' },
      alignment: { default: 'left' },
    }
  },
  parseHTML() {
    return [{ tag: 'button-block' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['button-block', mergeAttributes(HTMLAttributes), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ButtonsComponent)
  },
})

export default Buttons
