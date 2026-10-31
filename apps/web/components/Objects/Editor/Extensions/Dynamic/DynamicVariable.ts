import { InputRule, mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import DynamicVariableComponent from './DynamicVariableComponent'
import { VARIABLE_INPUT_REGEX, variableDef } from './dynamicRules'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dynamicVariable: {
      insertDynamicVariable: (path?: string) => ReturnType
    }
  }
}

// An inline placeholder (`user.first_name`, `course.name`…). The API swaps it
// for plain text before a learner gets the page.
export default Node.create({
  name: 'dynamicVariable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      path: {
        default: 'user.first_name',
        parseHTML: (el) => el.getAttribute('data-path') || 'user.first_name',
        renderHTML: (attrs) => ({ 'data-path': attrs.path }),
      },
      fallback: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-fallback') || '',
        renderHTML: (attrs) => (attrs.fallback ? { 'data-fallback': attrs.fallback } : {}),
      },
      format: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-format'),
        renderHTML: (attrs) => (attrs.format ? { 'data-format': attrs.format } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'dynamic-variable' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['dynamic-variable', mergeAttributes(HTMLAttributes), `{{${node.attrs.path}}}`]
  },

  renderText({ node }) {
    return `{{${node.attrs.path}}}`
  },

  addCommands() {
    return {
      insertDynamicVariable:
        (path = 'user.first_name') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { path } }),
    }
  },

  addInputRules() {
    // Typing {{ course.name }} turns into a variable chip. Unknown paths stay
    // text, which is what the server does with them too.
    return [
      new InputRule({
        find: VARIABLE_INPUT_REGEX,
        handler: ({ state, range, match }) => {
          const path = match[1]
          if (!variableDef(path)) return null
          state.tr.replaceWith(range.from, range.to, this.type.create({ path }))
        },
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DynamicVariableComponent)
  },
})
