import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

/*
 H5P interactive content — EMBED ONLY, by design.

 The H5P core (the player, the editor, the content types) is AGPL-licensed, so
 vendoring it into LearnHouse would put the whole application under the AGPL.
 We also do not accept, unpack or serve `.h5p` packages: hosting the runtime is
 the part that carries the licence obligation, and unpacking author-supplied
 archives is a file-handling risk we have no reason to take.

 So there is no authoring integration here, and there never was one removed.
 The author creates the content on their own H5P host (H5P.com, Lumi, or a
 self-hosted Drupal/Moodle/WordPress site), pastes the embed URL, and we render
 it in a sandboxed iframe. The content — and its licence — stays on their host.
*/

const H5PBlockComponent = dynamic(() => import('./H5PBlockComponent'), {
  ssr: false,
})

export default Node.create({
  name: 'blockH5P',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      h5pUrl: {
        default: '',
      },
      // Kept in sync with the host's H5P.Resizer postMessage, so the frame
      // opens at roughly the right size next time instead of jumping.
      height: {
        default: 400,
      },
      // Used for the iframe title attribute (a11y) and as the text this block
      // contributes to search/RAG indexing.
      title: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-h5p',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-h5p', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(H5PBlockComponent as any)
  },
})
