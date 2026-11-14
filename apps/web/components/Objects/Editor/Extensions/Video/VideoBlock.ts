import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'
import { VIDEO_EXTRA_ATTRS } from '../../Blocks/schema/blockAttrs'

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
      // Added by the blocks redesign; optional, defaults keep old content as-is.
      ...VIDEO_EXTRA_ATTRS,
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
