import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { DocCalloutComponent } from './DocCalloutComponent'

export type DocCalloutVariant = 'info' | 'warning' | 'success' | 'tip'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    docCallout: {
      setDocCallout: (attrs?: { variant?: DocCalloutVariant }) => ReturnType
    }
  }
}

export const DocCallout = Node.create({
  name: 'docCallout',

  group: 'block',

  content: 'inline*',

  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (element) => element.getAttribute('data-variant') || 'info',
        renderHTML: (attributes) => ({
          'data-variant': attributes.variant,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="doc-callout"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'doc-callout' }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocCalloutComponent)
  },

  addCommands() {
    return {
      setDocCallout:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { variant: attrs?.variant || 'info' },
            content: [{ type: 'text', text: 'Type your callout text here...' }],
          })
        },
    }
  },
})

export default DocCallout
