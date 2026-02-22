import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import PlaygroundBlockComponent from './PlaygroundBlockComponent'

export const PlaygroundBlockExtension = Node.create({
  name: 'playgroundBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: false,
  isolating: true,

  addAttributes() {
    return {
      blockUuid: { default: '' },
      x: { default: 100 },
      y: { default: 100 },
      width: { default: 520 },
      height: { default: 400 },
      htmlContent: { default: null },
      sessionUuid: { default: null },
      iterationCount: { default: 0 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="playground-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'playground-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PlaygroundBlockComponent, {
      stopEvent: () => true,
    })
  },
})
