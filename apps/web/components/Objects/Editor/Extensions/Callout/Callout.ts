import { mergeAttributes, Node } from '@tiptap/core'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import CalloutComponent from './CalloutComponent'
import { CALLOUT_CONTENT } from './calloutContent'
import { CALLOUT_EXTRA_ATTRS } from '../../Blocks/schema/blockAttrs'

export default Node.create({
  name: 'callout',
  group: 'block',
  draggable: true,
  content: CALLOUT_CONTENT,

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
      ...CALLOUT_EXTRA_ATTRS,
    }
  },

  parseHTML() {
    return [{ tag: 'callout[data-callout-type]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['callout', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return lhNodeView(CalloutComponent)
  },
})
