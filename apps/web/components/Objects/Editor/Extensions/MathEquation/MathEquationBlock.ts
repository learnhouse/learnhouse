import { mergeAttributes, Node } from '@tiptap/core'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
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
    return lhNodeView(MathEquationBlockComponent as any)
  },
})
