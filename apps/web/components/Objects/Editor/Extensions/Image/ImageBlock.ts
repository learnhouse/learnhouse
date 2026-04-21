import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import ImageBlockComponent from './ImageBlockComponent'

export default Node.create({
  name: 'blockImage',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      blockObject: {
        default: null,
      },
      size: {
        width: 300,
      },
      alignment: {
        default: 'center',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-image',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-image', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockComponent)
  },
})
