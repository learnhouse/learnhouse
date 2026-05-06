import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

const QuizBlockComponent = dynamic(() => import('./QuizBlockComponent'), {
  ssr: false,
})

export default Node.create({
  name: 'blockQuiz',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      quizId: {
        value: null,
      },
      questions: {
        default: [],
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-quiz',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-quiz', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(QuizBlockComponent as any)
  },
})
