import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import AudioBlockComponent from './AudioBlockComponent'

export interface AudioBlockOptions {
  activity: { activity_uuid?: string } | null
}

export const AudioBlock = Node.create<AudioBlockOptions>({
  name: 'blockAudio',
  group: 'block',
  draggable: false,
  atom: true,
  addOptions() {
    return { activity: null }
  },
  addAttributes() {
    return { blockObject: { default: null } }
  },
  parseHTML() {
    return [{ tag: 'block-audio' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['block-audio', mergeAttributes(HTMLAttributes)]
  },
  addNodeView() {
    return ReactNodeViewRenderer(AudioBlockComponent as any)
  },
})

export default AudioBlock
