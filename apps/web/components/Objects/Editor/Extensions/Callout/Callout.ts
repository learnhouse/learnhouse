import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import CalloutComponent from './CalloutComponent'

export default Node.create({
  name: 'callout',
  group: 'block',
  draggable: true,
  content: 'text*',

  addAttributes() {
    return {
      type: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-callout-type') || 'info',
        renderHTML: (attrs) => ({ 'data-callout-type': attrs.type }),
      },
      dismissible: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-dismissible') === 'true',
        renderHTML: (attrs) => attrs.dismissible ? { 'data-dismissible': 'true' } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'callout[data-callout-type]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['callout', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutComponent)
  },
})
