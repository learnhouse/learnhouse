import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'

const HotspotView = dynamic(() => import('./HotspotView'), { ssr: false })

// English fallback example (inserts from the slash menu / gallery use the
// translated `defaultHotspotContent(t)`). It works without an image: the view
// draws a neutral placeholder illustration with a circle and a square at
// these spots.
const DEFAULT_SPOTS = [
  { id: 'spot1', x: 28, y: 38, r: 9, label: 'The circle', explanation: 'Round shapes have no corners.', correct: true },
  { id: 'spot2', x: 70, y: 62, r: 9, label: 'The square', explanation: 'A square has four equal sides.', correct: true },
]

export default Node.create({
  name: 'expHotspot',
  group: 'block',
  draggable: true,
  atom: true,

  addOptions() {
    return { editable: true, activity: undefined as any }
  },

  addAttributes() {
    return {
      blockId: blockIdAttr(),
      title: jsonAttr('title', 'Find the shapes'),
      instructions: jsonAttr('instructions', 'Click the circle and the square.'),
      imageUrl: jsonAttr('imageUrl', ''),
      // Server object of an image uploaded into this block (same shape as
      // blockImage's `blockObject`). When set, the view resolves the media URL
      // from it; `imageUrl` keeps a plain URL for renderers that only read it.
      imageObject: jsonAttr<Record<string, unknown> | null>('imageObject', null),
      spots: jsonAttr('spots', DEFAULT_SPOTS),
      mode: jsonAttr('mode', 'find'),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-hotspot-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-hotspot-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(HotspotView as any)
  },
})
