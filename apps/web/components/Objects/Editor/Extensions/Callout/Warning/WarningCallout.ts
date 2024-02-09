import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import WarningCalloutComponent from './WarningCalloutComponent'

export default Node.create({
  name: 'calloutWarning',
  group: 'block',
  draggable: true,
  content: 'text*',

  // TODO : multi line support

  parseHTML() {
    return [
      {
        tag: 'callout-warning',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['callout-info', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(WarningCalloutComponent)
  },
})
