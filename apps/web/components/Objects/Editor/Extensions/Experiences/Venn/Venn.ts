import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'
import { exampleVenn } from './vennModel'

const VennView = dynamic(() => import('./VennView'), { ssr: false })

/*
 "Venn compare": learners place facts in two overlapping circles (only A,
 both, only B, and optionally neither). Attrs are plain JSON (see
 vennModel.ts) and round-trip through HTML as JSON data attributes so
 copy/paste keeps the content and the blockId. The defaults are the English
 example; inserting from the slash menu or the gallery fills a translated one.
*/
const EXAMPLE = exampleVenn()

export default Node.create({
  name: 'expVenn',
  group: 'block',
  draggable: true,
  atom: true,

  addOptions() {
    return { editable: true, activity: undefined as any }
  },

  addAttributes() {
    return {
      blockId: blockIdAttr(),
      title: jsonAttr('title', EXAMPLE.title),
      instructions: jsonAttr('instructions', EXAMPLE.instructions),
      sets: jsonAttr('sets', EXAMPLE.sets),
      items: jsonAttr('items', EXAMPLE.items),
      showNeither: jsonAttr('showNeither', false),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-venn-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-venn-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(VennView as any)
  },
})
