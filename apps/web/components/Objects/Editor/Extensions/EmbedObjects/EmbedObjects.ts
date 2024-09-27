import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import EmbedObjectsComponent from './EmbedObjectsComponent'


export default Node.create({
  name: 'blockEmbed',
  group: 'block',

  addAttributes() {
    return {
      embedUrl: {
        default: null,
      },
      embedCode: {
        default: null,
      },
      embedType: {
        default: null,
      },
      embedHeight: {
        default: 300,
      },
      embedWidth: {
        default: '100%',
      },
      alignment: {
        default: 'left',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-embed',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-embed', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedObjectsComponent)
  },
  
})