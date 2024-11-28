import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'

export const NoTextInput = Extension.create({
  name: 'noTextInput',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('noTextInput'),
        filterTransaction: (transaction) => {
          // Block all content-changing transactions
          return !transaction.docChanged
        },
      }),
    ]
  },
})
