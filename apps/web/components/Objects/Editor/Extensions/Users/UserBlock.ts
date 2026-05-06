import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

const UserBlockComponent = dynamic(() => import('./UserBlockComponent'), {
  ssr: false,
})

export default Node.create({
  name: 'blockUser',
  group: 'block',
  draggable: true,
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
    return ['block-user', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(UserBlockComponent as any)
  },
})
