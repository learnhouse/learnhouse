import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import VideoBlockComponent from './VideoBlockComponent'

export interface VideoBlockOptions {
  activity: { activity_uuid?: string } | null
}

export const VideoBlock = Node.create<VideoBlockOptions>({
  name: 'blockVideo',
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
    return [{ tag: 'block-video' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['block-video', mergeAttributes(HTMLAttributes)]
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoBlockComponent as any)
  },
})

export default VideoBlock
