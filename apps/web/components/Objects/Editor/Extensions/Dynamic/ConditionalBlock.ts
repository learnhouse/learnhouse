import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ConditionalBlockComponent from './ConditionalBlockComponent'
import { DEFAULT_RULES, RuleGroup, negateRules } from './dynamicRules'

export interface ConditionalBlockOptions {
  rules?: RuleGroup
  label?: string
  hiddenMessage?: string
  // Open the rule builder as soon as the block appears.
  openRules?: boolean
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    conditionalBlock: {
      insertConditionalBlock: (options?: ConditionalBlockOptions) => ReturnType
      // Two blocks splitting learners in half: version A and version B.
      insertABTest: () => ReturnType
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
      // Shown instead of the block to readers who don't match, e.g.
      // "Unlocks after your first week". Optional.
      hiddenMessage: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-hidden-message') || '',
        renderHTML: (attrs) => (attrs.hiddenMessage ? { 'data-hidden-message': attrs.hiddenMessage } : {}),
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

  addStorage() {
    return { openRulesOnMount: false }
  },

  addCommands() {
    return {
      insertConditionalBlock:
        (options = {}) =>
        ({ state, chain }) => {
          const attrs = {
            rules: options.rules ?? DEFAULT_RULES,
            label: options.label ?? '',
            hiddenMessage: options.hiddenMessage ?? '',
          }
          this.storage.openRulesOnMount = !!options.openRules
          // Wrap the selected blocks, or start an empty one at the cursor.
          const { from, to, empty } = state.selection
          if (!empty && from !== to) {
            return chain().wrapIn(this.name, attrs).run()
          }
          return chain()
            .insertContent({ type: this.name, attrs, content: [{ type: 'paragraph' }] })
            .run()
        },
      insertABTest:
        () =>
        ({ chain }) => {
          const a: RuleGroup = { match: 'all', conditions: [{ field: 'user.bucket', op: 'lt', value: 50 }] }
          const block = (label: string, rules: RuleGroup, text: string) => ({
            type: this.name,
            attrs: { rules, label, hiddenMessage: '' },
            content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
          })
          return chain()
            .insertContent([
              block('Version A', a, 'Version A: half of learners see this.'),
              block('Version B', negateRules(a), 'Version B: the other half see this.'),
            ])
            .run()
        },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConditionalBlockComponent)
  },
})
