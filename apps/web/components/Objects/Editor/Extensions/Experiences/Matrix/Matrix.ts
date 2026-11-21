import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'
import { exampleMatrix } from './matrixModel'

const MatrixView = dynamic(() => import('./MatrixView'), { ssr: false })

/*
 "Property grid": learners tick which properties (columns) apply to each row.
 `cells` holds the correct ticks as { "rowId:colId": true }; in single mode
 every row has exactly one. Attrs are plain JSON (see matrixModel.ts) and
 round-trip through HTML as JSON data attributes. The defaults are the
 English example; inserts from the slash menu or the gallery are translated.
*/
const EXAMPLE = exampleMatrix()

export default Node.create({
  name: 'expMatrix',
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
      rows: jsonAttr('rows', EXAMPLE.rows),
      columns: jsonAttr('columns', EXAMPLE.columns),
      cells: jsonAttr('cells', EXAMPLE.cells),
      mode: jsonAttr('mode', 'multi'),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-matrix-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-matrix-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(MatrixView as any)
  },
})
