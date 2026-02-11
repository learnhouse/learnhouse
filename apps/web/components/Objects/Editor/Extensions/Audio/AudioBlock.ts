import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import AudioBlockComponent from './AudioBlockComponent'

export default Node.create({
  name: 'blockAudio',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      blockObject: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-audio',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-audio', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioBlockComponent)
  },
})
