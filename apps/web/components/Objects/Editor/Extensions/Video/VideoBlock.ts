import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

const VideoBlockComponent = dynamic(() => import('./VideoBlockComponent'), {
  ssr: false,
})

export default Node.create({
  name: 'blockVideo',
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
        tag: 'block-video',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-video', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoBlockComponent as any)
  },
})
