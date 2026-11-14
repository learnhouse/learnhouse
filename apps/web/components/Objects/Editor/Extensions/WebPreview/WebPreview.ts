import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

const WebPreviewComponent = dynamic(() => import('./WebPreviewComponent'), {
  ssr: false,
})

// Node schema for the Web preview block (attrs are read by WebPreviewComponent).
const WebPreview = Node.create({
  name: 'blockWebPreview',
  group: 'block',
  draggable: true,
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
      openInPopup: { default: false },
      // Added with the redesign; older cards have none and render as before.
      // 'large' (image on top, the original card) or 'compact' (thumbnail at the side).
      layout: { default: 'large' },
      // Author overrides; Refresh rewrites the fetched fields above, never these.
      customTitle: { default: null },
      customDescription: { default: null },
    }
  },

  parseHTML() {
    return [
      { tag: 'web-preview' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['web-preview', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(WebPreviewComponent as any)
  },
})

export default WebPreview; 