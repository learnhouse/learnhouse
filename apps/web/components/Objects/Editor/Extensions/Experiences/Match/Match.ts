import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'
import { exampleMatch } from './matchModel'

const MatchView = dynamic(() => import('./MatchView'), { ssr: false })

/*
 "Match pairs": connect two columns, or play a memory game with the same
 pairs (see matchModel.ts). Attrs round-trip through HTML as JSON data
 attributes; the defaults are the English example.
*/
const EXAMPLE = exampleMatch()

export default Node.create({
  name: 'expMatch',
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
      pairs: jsonAttr('pairs', EXAMPLE.pairs),
      mode: jsonAttr('mode', 'connect'),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-match-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-match-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(MatchView as any)
  },
})
