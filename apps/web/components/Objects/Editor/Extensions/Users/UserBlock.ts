import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import UserBlockComponent from './UserBlockComponent'

export default Node.create({
  name: 'blockUser',
  group: 'block',

  atom: true,

  addAttributes() {
    return {
      user_id: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-user',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-user', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(UserBlockComponent)
  },
})
