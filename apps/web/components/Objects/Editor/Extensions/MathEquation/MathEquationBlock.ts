import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import MathEquationBlockComponent from './MathEquationBlockComponent'

export default Node.create({
  name: 'blockMathEquation',
  group: 'block',

  atom: true,

  addAttributes() {
    return {
      math_equation: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-math-equation',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-math-equation', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathEquationBlockComponent)
  },
})
