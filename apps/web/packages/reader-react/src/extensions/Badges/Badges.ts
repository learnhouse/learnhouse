import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import BadgesComponent from './BadgesComponent'

export const Badges = Node.create({
  name: 'badge',
  group: 'block',
  draggable: false,
  content: 'text*',
  addAttributes() {
    return {
      color: { default: 'sky' },
      emoji: { default: '💡' },
    }
  },
  parseHTML() {
    return [{ tag: 'badge' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['badge', mergeAttributes(HTMLAttributes), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(BadgesComponent)
  },
})

export default Badges
