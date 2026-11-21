import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'
import { exampleLabel } from './labelModel'

const LabelView = dynamic(() => import('./LabelView'), { ssr: false })

/*
 "Label the diagram": learners drag labels onto numbered pins on an image.
 Attrs are plain JSON (see labelModel.ts). The defaults are the English
 example, which plays on a drawn placeholder until an image is added.
*/
const EXAMPLE = exampleLabel()

export default Node.create({
  name: 'expLabel',
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
      imageUrl: jsonAttr('imageUrl', ''),
      // Server object of an image uploaded into this block (same shape as
      // Hotspot's `imageObject`); `imageUrl` keeps a plain URL next to it.
      imageObject: jsonAttr<Record<string, unknown> | null>('imageObject', null),
      pins: jsonAttr('pins', EXAMPLE.pins),
      distractors: jsonAttr('distractors', EXAMPLE.distractors),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-label-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-label-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(LabelView as any)
  },
})
