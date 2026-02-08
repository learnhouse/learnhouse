import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { DocImageComponent } from './DocImageComponent'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    docImage: {
      setDocImage: (attrs?: { src?: string; alt?: string; title?: string }) => ReturnType
    }
  }
}

export const DocImage = Node.create({
  name: 'docImage',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      src: {
        default: '',
      },
      alt: {
        default: '',
      },
      title: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="doc-image"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'doc-image' }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocImageComponent)
  },

  addCommands() {
    return {
      setDocImage:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              src: attrs?.src || '',
              alt: attrs?.alt || '',
              title: attrs?.title || '',
            },
          })
        },
    }
  },
})

export default DocImage
