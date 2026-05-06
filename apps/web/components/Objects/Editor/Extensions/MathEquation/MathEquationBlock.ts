import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

const MathEquationBlockComponent = dynamic(
  () => import('./MathEquationBlockComponent'),
  { ssr: false }
)

export default Node.create({
  name: 'blockMathEquation',
  group: 'block',
  draggable: true,
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
    return ['block-math-equation', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathEquationBlockComponent as any)
  },
})
