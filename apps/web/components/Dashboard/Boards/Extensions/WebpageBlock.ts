import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import WebpageBlockComponent from './WebpageBlockComponent'

export const WebpageBlockExtension = Node.create({
  name: 'webpageBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      x: { default: 100 },
      y: { default: 100 },
      width: { default: 520 },
      height: { default: 400 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="webpage-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'webpage-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(WebpageBlockComponent)
  },
})
