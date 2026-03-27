import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import CodePlaygroundComponent from './CodePlaygroundComponent'

export default Node.create({
  name: 'blockCode',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      mode: {
        default: 'advanced',
      },
      languageId: {
        default: 71, // Python 3
      },
      languageName: {
        default: 'Python 3',
      },
      starterCode: {
        default: '# Write your code here\n',
      },
      testCases: {
        default: [],
      },
      description: {
        default: '',
      },
      hints: {
        default: [],
      },
      difficulty: {
        default: 'medium',
      },
      solutionCode: {
        default: '',
      },
      maxAttemptsBeforeReveal: {
        default: 3,
      },
      timeComplexity: {
        default: '',
      },
      spaceComplexity: {
        default: '',
      },
      timeLimitMs: {
        default: 10000,
      },
      sqliteDbPath: {
        default: '',
      },
      sqliteDbName: {
        default: '',
      },
      timedMode: {
        default: false,
      },
      timedDurationMs: {
        default: 300000, // 5 minutes default
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-code-playground',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-code-playground', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodePlaygroundComponent)
  },
})
