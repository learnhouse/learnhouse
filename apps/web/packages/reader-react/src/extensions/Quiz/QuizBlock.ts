import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import QuizBlockComponent from './QuizBlockComponent'

export const QuizBlock = Node.create({
  name: 'blockQuiz',
  group: 'block',
  draggable: false,
  atom: true,
  addAttributes() {
    return {
      quizId: { default: null },
      questions: { default: [] },
    }
  },
  parseHTML() {
    return [{ tag: 'block-quiz' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['block-quiz', mergeAttributes(HTMLAttributes)]
  },
  addNodeView() {
    return ReactNodeViewRenderer(QuizBlockComponent as any)
  },
})

export default QuizBlock
