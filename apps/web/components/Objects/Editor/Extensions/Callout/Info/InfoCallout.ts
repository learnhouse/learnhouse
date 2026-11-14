import { mergeAttributes, Node } from '@tiptap/core'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'

import InfoCalloutComponent from './InfoCalloutComponent'

export default Node.create({
  name: 'calloutInfo',
  group: 'block',
  draggable: true,
  content: 'text*',

  // TODO : multi line support

  parseHTML() {
    return [
      {
        tag: 'callout-info',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['callout-info', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return lhNodeView(InfoCalloutComponent)
  },
})
