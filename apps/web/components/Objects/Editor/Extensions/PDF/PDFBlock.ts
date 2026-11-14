import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'
import { PDF_EXTRA_ATTRS } from '../../Blocks/schema/blockAttrs'

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
      // Pixel height chosen by dragging the handle; null = DEFAULT_PDF_HEIGHT.
      pdfHeight: {
        default: null,
      },
      // Added by the blocks redesign; optional, defaults keep old content as-is.
      ...PDF_EXTRA_ATTRS,
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
