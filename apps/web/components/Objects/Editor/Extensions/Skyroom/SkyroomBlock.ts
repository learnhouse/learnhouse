import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

const SkyroomBlockComponent = dynamic(() => import('./SkyroomBlockComponent'), {
  ssr: false,
})

export default Node.create({
  name: 'blockSkyroom',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      // The liveclass_uuid of the Skyroom live class this block points at.
      // Stored on the node so the student view can resolve the room without
      // any authoring context.
      liveclass_uuid: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-skyroom',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-skyroom', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SkyroomBlockComponent as any)
  },
})
