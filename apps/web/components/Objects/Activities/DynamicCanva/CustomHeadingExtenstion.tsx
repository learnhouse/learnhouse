import Heading from '@tiptap/extension-heading'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { computeHeadingIds } from './headingIds'

export const headingIdsKey = new PluginKey<DecorationSet>('lhHeadingIds')

function decorate(doc: any): DecorationSet {
  const decorations = computeHeadingIds(doc).map((h) => {
    const node = doc.nodeAt(h.pos)
    return Decoration.node(h.pos, h.pos + node.nodeSize, { id: h.id })
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * Headings with ids the "On this page" outline can link to. The ids are
 * computed over the whole document (headingIds.ts), so duplicate titles get
 * distinct ids and an empty heading keeps the same id on every render; a
 * per-node renderHTML can't see the other headings, which is why this is a
 * decoration rather than an attribute.
 */
export const CustomHeading = Heading.extend({
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin<DecorationSet>({
        key: headingIdsKey,
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return headingIdsKey.getState(state)
          },
        },
      }),
    ]
  },
})
