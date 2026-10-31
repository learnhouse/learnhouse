import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ConditionalBlockComponent from './ConditionalBlockComponent'
import { DEFAULT_RULES } from './dynamicRules'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    conditionalBlock: {
      insertConditionalBlock: () => ReturnType
    }
  }
}

function parseRules(raw: string | null) {
  if (!raw) return DEFAULT_RULES
  try {
    return JSON.parse(raw)
  } catch {
    return DEFAULT_RULES
  }
}

// Blocks shown only to readers who match `rules`. The API drops the block
// (rules included) for everyone else; learners never get it.
export default Node.create({
  name: 'conditionalBlock',
  group: 'block',
  content: 'block+',
  draggable: true,
  defining: true,

  addAttributes() {
    return {
      rules: {
        default: DEFAULT_RULES,
        parseHTML: (el) => parseRules(el.getAttribute('data-rules')),
        renderHTML: (attrs) => ({ 'data-rules': JSON.stringify(attrs.rules ?? DEFAULT_RULES) }),
      },
      // Author's own note, e.g. "Advanced track". Never shown to learners.
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') || '',
        renderHTML: (attrs) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'conditional-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['conditional-block', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      insertConditionalBlock:
        () =>
        ({ state, chain }) => {
          // Wrap the selected blocks, or start an empty one at the cursor.
          const { from, to, empty } = state.selection
          if (!empty && from !== to) {
            return chain().wrapIn(this.name).run()
          }
          return chain()
            .insertContent({ type: this.name, content: [{ type: 'paragraph' }] })
            .run()
        },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConditionalBlockComponent)
  },
})
