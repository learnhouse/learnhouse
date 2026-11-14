import { mergeAttributes, Node } from '@tiptap/core'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
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
      // 'card' (the original full card) or 'compact' (one line). Old blocks
      // have no value and keep the card.
      layout: {
        default: 'card',
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
    return lhNodeView(UserBlockComponent as any)
  },
})
