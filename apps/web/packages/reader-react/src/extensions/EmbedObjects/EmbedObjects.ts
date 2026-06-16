import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import EmbedObjectsComponent from './EmbedObjectsComponent'

export const EmbedObjects = Node.create({
  name: 'blockEmbed',
  group: 'block',
  draggable: false,
  atom: true,
  addAttributes() {
    return {
      embedUrl: { default: null },
      embedCode: { default: null },
      embedType: { default: null },
      embedHeight: { default: 300 },
      embedWidth: { default: '100%' },
      alignment: { default: 'left' },
    }
  },
  parseHTML() {
    return [{ tag: 'block-embed' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['block-embed', mergeAttributes(HTMLAttributes)]
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedObjectsComponent as any)
  },
})

export default EmbedObjects
