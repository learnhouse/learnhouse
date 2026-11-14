import { useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'

import EditorOptionsProvider from '@components/Contexts/Editor/EditorContext'
import TableOfContents from './TableOfContents'
import { getActivityExtensions, normalizeActivityContent } from './activityExtensions'
import AICanvaToolkit from './AI/AICanvaToolkit'
import BlockThemeScope, { type BlockThemeRequest } from '@components/Objects/Activities/BlockTheme/BlockThemeScope'

interface Editor {
  content: string
  activity: any
  hideTableOfContents?: boolean
  // Passed by the activity/embed/board renderers so the video block can build
  // stream URLs even where the Org/Course React contexts aren't populated.
  courseUuid?: string
  orgUuid?: string
  /** Block theme: 'auto' (default) adapts to the background behind the lesson;
   *  'light' / 'dark' force one (see BlockTheme/blockTheme.ts). */
  theme?: BlockThemeRequest
}

function Canva(props: Editor) {
  /**
   * Important Note : This is a workaround to enable user interaction features to be implemented easily, like text selection, AI features and other planned features, this is set to true but otherwise it should be set to false.
   * Another workaround is implemented below to disable the editor from being edited by the user by setting the caret-color to transparent and using a custom extension to filter out transactions that add/edit/remove text.
   * To let the various Custom Extensions know that the editor is not editable, React context (EditorOptionsProvider) will be used instead of props.extension.options.editable.
   */
  const isEditable = true

  const normalizedContent = useMemo(() => normalizeActivityContent(props.content), [props.content])

  const editor: any = useEditor({
    immediatelyRender: false,
    editable: isEditable,
    // The surface is contenteditable only so selection works (see above). On a
    // phone that would raise the keyboard and spellcheck squiggles on every
    // tap into the text, so ask for neither.
    editorProps: {
      attributes: {
        inputmode: 'none',
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
      },
    },
    extensions: getActivityExtensions(props),

    content: normalizedContent,
  })

  return (
    <EditorOptionsProvider options={{ isEditable: false }}>
      <BlockThemeScope theme={props.theme} className="w-full mx-auto">
        <AICanvaToolkit activity={props.activity} editor={editor} />
        <div className="canva-content-wrapper" data-lesson-content="">
          {!props.hideTableOfContents && <TableOfContents editor={editor} />}
          <EditorContent editor={editor} />
        </div>
      </BlockThemeScope>
    </EditorOptionsProvider>
  )
}

export default Canva
