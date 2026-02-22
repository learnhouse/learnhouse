import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import PodcastBlockComponent from './PodcastBlockComponent'

export const PodcastBlockExtension = Node.create({
  name: 'podcastBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      podcastUuid: { default: '' },
      episodeUuid: { default: '' },
      x: { default: 100 },
      y: { default: 100 },
      width: { default: 400 },
      height: { default: 280 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="podcast-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'podcast-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PodcastBlockComponent)
  },
})
