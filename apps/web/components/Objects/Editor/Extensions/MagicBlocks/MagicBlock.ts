import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { v4 as uuidv4 } from 'uuid'

import MagicBlockComponent from './MagicBlockComponent'

export default Node.create({
  name: 'blockMagic',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      blockUuid: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-uuid'),
        renderHTML: (attributes) => ({
          'data-block-uuid': attributes.blockUuid,
        }),
      },
      sessionUuid: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-session-uuid'),
        renderHTML: (attributes) => ({
          'data-session-uuid': attributes.sessionUuid,
        }),
      },
      htmlContent: {
        default: null,
      },
      iterationCount: {
        default: 0,
      },
      title: {
        default: 'Interactive Element',
      },
      height: {
        default: 400,
        parseHTML: (element) => {
          const height = element.getAttribute('data-height')
          return height ? parseInt(height, 10) : 400
        },
        renderHTML: (attributes) => ({
          'data-height': attributes.height,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-magic',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-magic', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MagicBlockComponent)
  },

  onCreate() {
    // Generate a unique block UUID if not present
    this.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'blockMagic' && !node.attrs.blockUuid) {
        const tr = this.editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          blockUuid: `magic_${uuidv4()}`,
        })
        this.editor.view.dispatch(tr)
      }
    })
  },
})
