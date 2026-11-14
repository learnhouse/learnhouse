import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'
import { IMAGE_EXTRA_ATTRS } from '../../Blocks/schema/blockAttrs'

const ImageBlockComponent = dynamic(() => import('./ImageBlockComponent'), {
  ssr: false,
})

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
      unsplash_url: {
        default: null,
      },
      unsplash_photographer_name: {
        default: null,
      },
      unsplash_photographer_url: {
        default: null,
      },
      unsplash_photo_url: {
        default: null,
      },
      // Added by the blocks redesign; optional, defaults keep old content as-is.
      ...IMAGE_EXTRA_ATTRS,
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
    return ReactNodeViewRenderer(ImageBlockComponent as any)
  },
})
