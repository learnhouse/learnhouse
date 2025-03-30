import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ButtonsExtension from './ButtonsExtension'

export default Node.create({
  name: 'button',
  group: 'block',
  draggable: true,
  content: 'text*',

  addAttributes() {
    return {
      emoji: {
        default: '🔗',
      },
      link: {
        default: '',
      },
      color: {
        default: 'blue',
      },
      alignment: {
        default: 'left',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'button-block',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['button-block', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ButtonsExtension)
  },
})
