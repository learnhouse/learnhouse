import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import FrameBoxComponent from './FrameBoxComponent'

export const FrameBoxExtension = Node.create({
  name: 'frameBox',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      x: { default: 100 },
      y: { default: 100 },
      width: { default: 400 },
      height: { default: 300 },
      title: { default: 'Frame' },
      locked: { default: false },
      color: { default: 'purple' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="frame-box"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'frame-box' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FrameBoxComponent)
  },
})
