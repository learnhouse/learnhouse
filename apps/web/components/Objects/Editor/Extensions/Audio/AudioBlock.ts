import { mergeAttributes, Node } from '@tiptap/core'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import dynamic from 'next/dynamic'
import { AUDIO_EXTRA_ATTRS } from '../../Blocks/schema/blockAttrs'

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
      // Added by the blocks redesign; optional, defaults keep old content as-is.
      ...AUDIO_EXTRA_ATTRS,
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
