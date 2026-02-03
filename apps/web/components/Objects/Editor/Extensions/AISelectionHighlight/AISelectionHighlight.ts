import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface AISelectionHighlightOptions {
  className: string
}

export interface AISelectionHighlightStorage {
  highlightRange: { from: number; to: number } | null
}

export const aiSelectionHighlightPluginKey = new PluginKey('aiSelectionHighlight')

/**
 * Helper function to set AI selection highlight from outside the editor
 * Call this with the editor instance and the range to highlight
 */
export function setAIHighlight(editor: any, range: { from: number; to: number } | null) {
  if (!editor || !editor.view) return

  const { tr } = editor.state
  tr.setMeta(aiSelectionHighlightPluginKey, { range })
  editor.view.dispatch(tr)
}

/**
 * Helper function to clear AI selection highlight
 */
export function clearAIHighlight(editor: any) {
  setAIHighlight(editor, null)
}

const AISelectionHighlight = Extension.create<AISelectionHighlightOptions, AISelectionHighlightStorage>({
  name: 'aiSelectionHighlight',

  addOptions() {
    return {
      className: 'ai-selection-highlight',
    }
  },

  addStorage() {
    return {
      highlightRange: null,
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    const storage = this.storage

    return [
      new Plugin({
        key: aiSelectionHighlightPluginKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, oldDecorationSet, oldState, newState) {
            // Check if there's a meta update for our plugin
            const meta = tr.getMeta(aiSelectionHighlightPluginKey)

            if (meta !== undefined) {
              const { range } = meta

              // Store in extension storage
              storage.highlightRange = range

              if (range && range.from < range.to) {
                // Validate range is within document bounds
                const docSize = newState.doc.content.size
                const from = Math.max(0, Math.min(range.from, docSize))
                const to = Math.max(0, Math.min(range.to, docSize))

                if (from < to) {
                  // Create decoration for the selection range
                  const decoration = Decoration.inline(from, to, {
                    class: options.className,
                  })
                  return DecorationSet.create(newState.doc, [decoration])
                }
              }

              // Clear decorations if range is null or invalid
              return DecorationSet.empty
            }

            // If the document changed, map the decorations to new positions
            if (tr.docChanged && oldDecorationSet.find().length > 0) {
              return oldDecorationSet.map(tr.mapping, newState.doc)
            }

            // Keep existing decorations if no changes
            return oldDecorationSet
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})

export default AISelectionHighlight
