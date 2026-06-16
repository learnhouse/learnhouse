import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ImageBlockComponent from './ImageBlockComponent'

export interface ImageBlockOptions {
  activity: { activity_uuid?: string } | null
}

export const ImageBlock = Node.create<ImageBlockOptions>({
  name: 'blockImage',
  group: 'block',
  draggable: false,
  atom: true,
  addOptions() {
    return { activity: null }
  },
  addAttributes() {
    return {
      blockObject: { default: null },
      size: { default: { width: 300 } },
      alignment: { default: 'center' },
      unsplash_url: { default: null },
      unsplash_photographer_name: { default: null },
      unsplash_photographer_url: { default: null },
      unsplash_photo_url: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'block-image' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['block-image', mergeAttributes(HTMLAttributes)]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockComponent as any)
  },
})

export default ImageBlock
