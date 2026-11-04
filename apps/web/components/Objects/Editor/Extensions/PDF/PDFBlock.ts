import { mergeAttributes, Node } from '@tiptap/core'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
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
      // Pixel height chosen by dragging the handle; null = DEFAULT_PDF_HEIGHT.
      pdfHeight: {
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
    return lhNodeView(PDFBlockComponent as any)
  },
})
