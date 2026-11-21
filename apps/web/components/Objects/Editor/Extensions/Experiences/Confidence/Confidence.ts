import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'
import { exampleConfidence } from './confidenceModel'

const ConfidenceView = dynamic(() => import('./ConfidenceView'), { ssr: false })

/*
 "Confidence check": learners answer, say how sure they are, and see how well
 their confidence matched their accuracy. Attrs are plain JSON (see
 confidenceModel.ts) and round-trip through HTML as JSON data attributes. The
 defaults are the English example; inserting from the slash menu or the
 gallery fills a translated one.
*/
const EXAMPLE = exampleConfidence()

export default Node.create({
  name: 'expConfidence',
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
      questions: jsonAttr('questions', EXAMPLE.questions),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-confidence-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-confidence-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(ConfidenceView as any)
  },
})
