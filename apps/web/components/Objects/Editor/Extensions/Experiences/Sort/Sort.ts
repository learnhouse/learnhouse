import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'
import { exampleSort } from './sortModel'

const SortView = dynamic(() => import('./SortView'), { ssr: false })

/*
 "Sort it": learners put items into the right category. Attrs are plain JSON
 (see sortModel.ts); every attr round-trips through HTML as a JSON data
 attribute so copy/paste between editors keeps the content and the blockId.
 The defaults are the English example; inserting from the slash menu or the
 gallery fills a translated one.
*/
const EXAMPLE = exampleSort()

export default Node.create({
  name: 'expSort',
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
      categories: jsonAttr('categories', EXAMPLE.categories),
      items: jsonAttr('items', EXAMPLE.items),
      shuffle: jsonAttr('shuffle', true),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-sort-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-sort-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(SortView as any)
  },
})
