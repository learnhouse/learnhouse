import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import DrawingStrokeComponent from './DrawingStrokeComponent'

export const DrawingStrokeExtension = Node.create({
  name: 'drawingStroke',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      pathData: { default: '' },
      strokeColor: { default: '#000000' },
      strokeWidth: { default: 2 },
      x: { default: 0 },
      y: { default: 0 },
      viewBox: { default: '0 0 100 100' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="drawing-stroke"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawing-stroke' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawingStrokeComponent)
  },
})
