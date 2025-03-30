import BadgesExtension from '@/components/Objects/Editor/Extensions/Badges/BadgesExtension'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

export default Node.create({
  name: 'badge',
  group: 'block',
  draggable: true,
  content: 'text*',

  // TODO : multi line support

  addAttributes() {
    return {
      color: {
        default: 'sky',
      },
      emoji: {
        default: '💡',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'badge',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['badge', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BadgesExtension)
  },
})
