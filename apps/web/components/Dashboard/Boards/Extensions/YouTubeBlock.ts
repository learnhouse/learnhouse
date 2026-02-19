import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import YouTubeBlockComponent from './YouTubeBlockComponent'

export const YouTubeBlockExtension = Node.create({
  name: 'youtubeBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      videoId: { default: '' },
      x: { default: 100 },
      y: { default: 100 },
      width: { default: 480 },
      height: { default: 270 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="youtube-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'youtube-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(YouTubeBlockComponent)
  },
})
