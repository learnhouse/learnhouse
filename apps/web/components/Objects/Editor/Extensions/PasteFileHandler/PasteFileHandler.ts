import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { uploadNewImageFile } from '@services/blocks/Image/images'
import { uploadNewVideoFile } from '@services/blocks/Video/video'
import { uploadNewPDFFile } from '@services/blocks/Pdf/pdf'
import toast from 'react-hot-toast'

interface PasteFileHandlerOptions {
  activity: any
  getAccessToken: () => string | undefined
}

type BlockType = 'blockImage' | 'blockVideo' | 'blockPDF'

interface FileTypeMapping {
  blockType: BlockType
  label: string
  upload: (file: File, activityUuid: string, accessToken: string) => Promise<any>
}

const MIME_TYPE_MAP: Record<string, FileTypeMapping> = {
  'image/jpeg': { blockType: 'blockImage', label: 'image', upload: uploadNewImageFile },
  'image/png': { blockType: 'blockImage', label: 'image', upload: uploadNewImageFile },
  'image/webp': { blockType: 'blockImage', label: 'image', upload: uploadNewImageFile },
  'image/gif': { blockType: 'blockImage', label: 'image', upload: uploadNewImageFile },
  'video/mp4': { blockType: 'blockVideo', label: 'video', upload: uploadNewVideoFile },
  'video/webm': { blockType: 'blockVideo', label: 'video', upload: uploadNewVideoFile },
  'application/pdf': { blockType: 'blockPDF', label: 'PDF', upload: uploadNewPDFFile },
}

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
    const editor = this.editor

    const handleFiles = (files: FileList | File[], pos?: number) => {
      const accessToken = getAccessToken()
      if (!accessToken || !activity) return false

      let handled = false

      for (const file of Array.from(files)) {
        const mapping = MIME_TYPE_MAP[file.type]
        if (!mapping) continue

        handled = true
        const { blockType, label, upload } = mapping
        const activityUuid = activity.activity_uuid

        const toastId = toast.loading(`Uploading ${label}...`)

        // Upload first, then insert the block with the completed data.
        // This avoids the problem where block components initialize
        // blockObject in React state only once on mount — updating
        // node attrs via ProseMirror transactions doesn't trigger
        // a re-render of the component's internal state.
        upload(file, activityUuid, accessToken)
          .then((data) => {
            toast.dismiss(toastId)
            toast.success(`${label.charAt(0).toUpperCase() + label.slice(1)} uploaded`)

            const insertPos =
              pos !== undefined ? pos : editor.state.selection.anchor

            editor
              .chain()
              .focus()
              .insertContentAt(insertPos, {
                type: blockType,
                attrs: { blockObject: data },
              })
              .run()
          })
          .catch((error) => {
            toast.dismiss(toastId)
            toast.error(
              `Failed to upload ${file.name}: ${error.message || 'Unknown error'}`
            )
          })
      }

      return handled
    }

    return [
      new Plugin({
        key: new PluginKey('pasteFileHandler'),
        props: {
          handlePaste(_view, event) {
            const files = event.clipboardData?.files
            if (!files || files.length === 0) return false
            return handleFiles(files)
          },
          handleDrop(_view, event, _slice, moved) {
            if (moved) return false
            const files = (event as DragEvent).dataTransfer?.files
            if (!files || files.length === 0) return false

            // Get drop position
            const coordinates = _view.posAtCoords({
              left: (event as DragEvent).clientX,
              top: (event as DragEvent).clientY,
            })
            const pos = coordinates?.pos

            event.preventDefault()
            return handleFiles(files, pos)
          },
        },
      }),
    ]
  },
})

export default PasteFileHandler
