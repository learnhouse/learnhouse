import { mergeAttributes, Node } from '@tiptap/core'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import dynamic from 'next/dynamic'

const QuizBlockComponent = dynamic(() => import('./QuizBlockComponent'), {
  ssr: false,
})

/**
 * JSON-valued attr that survives copy/paste. The editor's clipboard goes
 * through HTML, and the default attribute rendering turned the questions array
 * into the string "[object Object]", so a pasted quiz lost every question.
 * Stored documents are JSON, so this only changes the clipboard/HTML form.
 */
function jsonAttr(name: string, fallback: unknown) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => {
      const raw = el.getAttribute(`data-${name}`) ?? el.getAttribute(name)
      if (!raw) return fallback
      try {
        return JSON.parse(raw)
      } catch {
        return fallback
      }
    },
    renderHTML: (attrs: Record<string, any>) =>
      attrs[name] == null ? {} : { [`data-${name}`]: JSON.stringify(attrs[name]) },
  }
}

export default Node.create({
  name: 'blockQuiz',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      quizId: {
        default: null,
      },
      questions: jsonAttr('questions', []),
      // Shuffle / attempts / reveal options (quizModel.ts). null = the old
      // behaviour: authored order, unlimited retries, answers revealed.
      settings: jsonAttr('settings', null),
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
    return lhNodeView(QuizBlockComponent as any)
  },
})
