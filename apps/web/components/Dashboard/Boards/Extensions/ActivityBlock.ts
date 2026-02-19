import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ActivityBlockComponent from './ActivityBlockComponent'

export const ActivityBlockExtension = Node.create({
  name: 'activityBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      activityUuid: { default: '' },
      courseUuid: { default: '' },
      x: { default: 100 },
      y: { default: 100 },
      width: { default: 520 },
      height: { default: 400 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="activity-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'activity-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ActivityBlockComponent)
  },
})
