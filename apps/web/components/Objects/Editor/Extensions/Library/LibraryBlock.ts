import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

const LibraryBlockComponent = dynamic(() => import('./LibraryBlockComponent'), {
  ssr: false,
})

/**
 * A reference to something that already lives in the org Library — a media file
 * or embed, or any other library resource (course, podcast, community, board,
 * playground).
 *
 * Unlike the typed upload blocks, this node stores no file of its own: it holds
 * the library resource's uuid, so the asset stays reusable and the file keeps
 * being served through the authed /media/{uuid}/file endpoint. `snapshot` is a
 * cached copy of the display metadata so the block paints before the live
 * refetch lands.
 */
export default Node.create({
  name: 'blockLibrary',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      resourceUuid: {
        default: null,
      },
      resourceType: {
        default: null,
      },
      snapshot: {
        default: null,
      },
      display: {
        default: 'inline',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-library',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-library', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(LibraryBlockComponent as any)
  },
})
