import { Extension } from '@tiptap/core'
import { createMediaDropPlugin } from '../../Blocks/media/mediaDropPlugin'
import '../../Blocks/blocks.css'

interface PasteFileHandlerOptions {
  activity: any
  getAccessToken: () => string | undefined
}

/**
 * Drop/paste files anywhere in the editor (images, video, audio, PDFs) and
 * paste links from known services as embeds. Uploads show as local
 * placeholders with progress, cancel and retry, and the block is inserted
 * only once the file is stored, so collaborators never see half states.
 * See Blocks/media/mediaDropPlugin.ts.
 */
const PasteFileHandler = Extension.create<PasteFileHandlerOptions>({
  name: 'pasteFileHandler',

  addOptions() {
    return {
      activity: null,
      getAccessToken: () => undefined,
    }
  },

  addProseMirrorPlugins() {
    const { activity, getAccessToken } = this.options
    return [
      createMediaDropPlugin({
        editor: this.editor,
        getActivity: () => activity,
        getAccessToken,
      }),
    ]
  },
})

export default PasteFileHandler
