import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'

const SpotMistakeView = dynamic(() => import('./SpotMistakeView'), { ssr: false })

// English fallback example; inserts from the slash menu / gallery use the
// translated `defaultSpotMistakeContent(t)`.
const DEFAULT_SEGMENTS = [
  { id: 'seg1', text: 'The Sun is a star.', isMistake: false, correction: '', explanation: '' },
  {
    id: 'seg2',
    text: 'The Earth goes around the Sun once a month.',
    isMistake: true,
    correction: 'The Earth goes around the Sun once a year.',
    explanation: 'One orbit takes about 365 days.',
  },
  { id: 'seg3', text: 'The Moon goes around the Earth.', isMistake: false, correction: '', explanation: '' },
  {
    id: 'seg4',
    text: 'Mars is the closest planet to the Sun.',
    isMistake: true,
    correction: 'Mercury is the closest planet to the Sun.',
    explanation: 'Mars is the fourth planet from the Sun.',
  },
]

export default Node.create({
  name: 'expSpotMistake',
  group: 'block',
  draggable: true,
  atom: true,

  addOptions() {
    return { editable: true, activity: undefined as any }
  },

  addAttributes() {
    return {
      blockId: blockIdAttr(),
      title: jsonAttr('title', 'Spot the mistakes'),
      instructions: jsonAttr('instructions', 'Click every sentence that contains a mistake.'),
      segments: jsonAttr('segments', DEFAULT_SEGMENTS),
      kind: jsonAttr('kind', 'text'),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-spot-mistake-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-spot-mistake-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(SpotMistakeView as any)
  },
})
