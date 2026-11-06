import { mergeAttributes, Node } from '@tiptap/core'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import dynamic from 'next/dynamic'

const AudioBlockComponent = dynamic(() => import('./AudioBlockComponent'), {
  ssr: false,
})

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
    return ['block-audio', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(AudioBlockComponent as any)
  },
})
