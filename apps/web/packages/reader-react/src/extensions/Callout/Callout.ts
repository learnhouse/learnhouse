import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import CalloutComponent from './CalloutComponent'

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  draggable: false,
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
        renderHTML: (attrs) => (attrs.dismissible ? { 'data-dismissible': 'true' } : {}),
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

export const InfoCallout = Node.create({
  name: 'calloutInfo',
  group: 'block',
  draggable: false,
  content: 'text*',
  parseHTML() {
    return [{ tag: 'callout-info' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['callout-info', mergeAttributes(HTMLAttributes), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutComponent)
  },
})

export const WarningCallout = Node.create({
  name: 'calloutWarning',
  group: 'block',
  draggable: false,
  content: 'text*',
  parseHTML() {
    return [{ tag: 'callout-warning' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['callout-warning', mergeAttributes(HTMLAttributes), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutComponent)
  },
})

export default Callout
