import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import WebPreviewComponent from './WebPreviewComponent'

const WebPreview = Node.create({
  name: 'blockWebPreview',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      url: { default: null },
      title: { default: null },
      description: { default: null },
      og_image: { default: null },
      favicon: { default: null },
      og_type: { default: null },
      og_url: { default: null },
      alignment: { default: 'left' },
      buttonLabel: { default: 'Visit Site' },
      showButton: { default: false },
    }
  },

  parseHTML() {
    return [
      { tag: 'web-preview' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['web-preview', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(WebPreviewComponent)
  },
})

export default WebPreview; 