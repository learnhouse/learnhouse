import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'

export const NoTextInput = Extension.create({
  name: 'noTextInput',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('noTextInput'),
        filterTransaction: (transaction) => {
          // If the transaction is adding text, stop it
          return (
            !transaction.docChanged ||
            transaction.steps.every((step) => {
              const { slice } = step.toJSON()
              return (
                !slice ||
                !slice.content.some(
                  (node: { type: string }) => node.type === 'text'
                )
              )
            })
          )
        },
      }),
    ]
  },
})
