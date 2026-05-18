import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import PDFBlockComponent from './PDFBlockComponent'

export interface PDFBlockOptions {
  activity: { activity_uuid?: string } | null
}

export const PDFBlock = Node.create<PDFBlockOptions>({
  name: 'blockPDF',
  group: 'block',
  draggable: false,
  atom: true,
  addOptions() {
    return { activity: null }
  },
  addAttributes() {
    return { blockObject: { default: null } }
  },
  parseHTML() {
    return [{ tag: 'block-pdf' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['block-pdf', mergeAttributes(HTMLAttributes)]
  },
  addNodeView() {
    return ReactNodeViewRenderer(PDFBlockComponent as any)
  },
})

export default PDFBlock
