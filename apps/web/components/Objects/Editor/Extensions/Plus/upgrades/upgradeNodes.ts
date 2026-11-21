/*
 New schema pieces of the block upgrades (EDITOR_PLUS_SPEC.md, section D):

 - `buttonGroup`: a row of the existing `button` nodes (content `button+`)
   with an alignment. Its HTML is a plain div around the buttons, so an
   older client that drops the wrapper still shows every button.
 - `inlineMath`: an inline atom holding LaTeX (`latex`), typed as `$…$` or
   made from a selection in the bubble menu. Rendered with KaTeX, like
   blockMathEquation. Its HTML keeps the LaTeX as text.
 - text alignment: `textAlign` on paragraphs and headings
   (@tiptap/extension-text-align, values start/center/end/justify). null
   writes nothing, so stored content is unchanged.

 Kept free of CSS and i18n imports so the schema tests can load it.
*/
import { InputRule, mergeAttributes, Node } from '@tiptap/core'
import TextAlign from '@tiptap/extension-text-align'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { TEXT_ALIGN_ATTR, TEXT_ALIGN_TYPES, TEXT_ALIGNMENTS } from '../../../Blocks/schema/blockAttrs'
import type { PlusContext } from '../types'
import { BUTTON_GROUP_ALIGNMENTS, buttonGroupAlignmentOf, INLINE_MATH_INPUT, isInlineMathCandidate } from './upgradesModel'
import { lazyView } from '../lazyView'
import { ButtonGroupFallback, InlineMathFallback } from './views/fallbacks'

// Lazy chunks (the KaTeX loader and the authoring popovers); the fallbacks
// are the views' learner markup.
const ButtonGroupView = lazyView('ButtonGroupView', () => import('./views/ButtonGroupView'), ButtonGroupFallback)
const InlineMathView = lazyView('InlineMathView', () => import('./views/InlineMathView'), InlineMathFallback)

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineMath: {
      /** Turn the selection (or the given LaTeX) into an inline formula. */
      insertInlineMath: (_latex: string) => ReturnType
    }
  }
}

export const ButtonGroup = Node.create({
  name: 'buttonGroup',
  group: 'block',
  content: 'button+',
  draggable: true,
  defining: true,

  addAttributes() {
    return {
      alignment: {
        default: 'left',
        parseHTML: (el: HTMLElement) => buttonGroupAlignmentOf({ alignment: el.getAttribute('data-alignment') }),
        renderHTML: (attrs: Record<string, any>) =>
          attrs.alignment && attrs.alignment !== 'left' && (BUTTON_GROUP_ALIGNMENTS as readonly string[]).includes(attrs.alignment)
            ? { 'data-alignment': attrs.alignment }
            : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="button-group"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'button-group' }), 0]
  },

  addNodeView() {
    return lhNodeView(ButtonGroupView)
  },
})

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-latex': String(attrs.latex ?? '') }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    // The LaTeX stays readable as text where KaTeX doesn't run.
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' }), String(node.attrs.latex ?? '')]
  },

  renderText({ node }) {
    return `$${node.attrs.latex ?? ''}$`
  },

  addCommands() {
    return {
      insertInlineMath:
        (latex: string) =>
        ({ commands }) => {
          const value = String(latex ?? '').trim()
          if (!value) return false
          return commands.insertContent({ type: this.name, attrs: { latex: value } })
        },
    }
  },

  addInputRules() {
    const type = this.type
    return [
      new InputRule({
        find: INLINE_MATH_INPUT,
        handler: ({ state, range, match }) => {
          const lead = match[1] ?? ''
          const latex = match[2] ?? ''
          if (!isInlineMathCandidate(latex)) return null
          state.tr.replaceWith(range.from + lead.length, range.to, type.create({ latex }))
        },
      }),
    ]
  },

  addNodeView() {
    return lhNodeView(InlineMathView)
  },
})

/** Text alignment on paragraphs and headings; nothing stored or rendered for the default. */
export const LHTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    return [{ types: this.options.types, attributes: { textAlign: TEXT_ALIGN_ATTR } }]
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-l': () => this.editor.commands.unsetTextAlign(),
      'Mod-Shift-e': () => this.editor.commands.setTextAlign('center'),
      'Mod-Shift-r': () => this.editor.commands.setTextAlign('end'),
      'Mod-Shift-j': () => this.editor.commands.setTextAlign('justify'),
    }
  },
}).configure({ types: [...TEXT_ALIGN_TYPES], alignments: [...TEXT_ALIGNMENTS], defaultAlignment: null })

export function createUpgradeNodes(_ctx: PlusContext = { mode: 'editor' }) {
  return [ButtonGroup, InlineMath, LHTextAlign]
}
