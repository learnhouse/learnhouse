import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

const PDFBlockComponent = dynamic(() => import('./PDFBlockComponent'), {
  ssr: false,
})

export default Node.create({
  name: 'blockPDF',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      blockObject: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-pdf',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-pdf', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PDFBlockComponent as any)
  },
})
