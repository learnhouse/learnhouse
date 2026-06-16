import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import MathEquationBlockComponent from './MathEquationBlockComponent'

export const MathEquationBlock = Node.create({
  name: 'blockMathEquation',
  group: 'block',
  draggable: false,
  atom: true,
  addAttributes() {
    return { math_equation: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'block-math-equation' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['block-math-equation', mergeAttributes(HTMLAttributes)]
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathEquationBlockComponent as any)
  },
})

export default MathEquationBlock
