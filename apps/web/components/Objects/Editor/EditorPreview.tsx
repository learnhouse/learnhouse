'use client'
import React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import EditorOptionsProvider from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'

// Extensions
import InfoCallout from './Extensions/Callout/Info/InfoCallout'
import WarningCallout from './Extensions/Callout/Warning/WarningCallout'
import ImageBlock from './Extensions/Image/ImageBlock'
import Youtube from '@tiptap/extension-youtube'
import VideoBlock from './Extensions/Video/VideoBlock'
import AudioBlock from './Extensions/Audio/AudioBlock'
import MathEquationBlock from './Extensions/MathEquation/MathEquationBlock'
import PDFBlock from './Extensions/PDF/PDFBlock'
import QuizBlock from './Extensions/Quiz/QuizBlock'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import { getLinkExtension } from './EditorConf'
import WebPreview from './Extensions/WebPreview/WebPreview'
import EmbedObjects from './Extensions/EmbedObjects/EmbedObjects'
import Badges from './Extensions/Badges/Badges'
import Buttons from './Extensions/Buttons/Buttons'
import Flipcard from './Extensions/Flipcard/Flipcard'
import Scenarios from './Extensions/Scenarios/Scenarios'
import UserBlock from './Extensions/Users/UserBlock'
import MagicBlock from './Extensions/MagicBlocks/MagicBlock'

// Lowlight — `common` already includes css, javascript, typescript, xml, python, java
import { common, createLowlight } from 'lowlight'
const lowlight = createLowlight(common)
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'

interface EditorPreviewProps {
  content: any
  activity?: any
}

function EditorPreview({ content, activity }: EditorPreviewProps) {
  const { t } = useTranslation()

  const editor = useEditor({
    editable: false,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: false,
        bulletList: {
          HTMLAttributes: {
            class: 'bullet-list',
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: 'ordered-list',
          },
        },
      }),
      InfoCallout.configure({
        editable: false,
      }),
      WarningCallout.configure({
        editable: false,
      }),
      ImageBlock.configure({
        editable: false,
        activity: activity,
      }),
      VideoBlock.configure({
        editable: false,
        activity: activity,
      }),
      AudioBlock.configure({
        editable: false,
        activity: activity,
      }),
      MathEquationBlock.configure({
        editable: false,
        activity: activity,
      }),
      PDFBlock.configure({
        editable: false,
        activity: activity,
      }),
      QuizBlock.configure({
        editable: false,
        activity: activity,
      }),
      Youtube.configure({
        controls: true,
        modestBranding: true,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      EmbedObjects.configure({
        editable: false,
        activity: activity,
      }),
      Badges.configure({
        editable: false,
        activity: activity,
      }),
      Buttons.configure({
        editable: false,
        activity: activity,
      }),
      UserBlock.configure({
        editable: false,
        activity: activity,
      }),
      Table.configure({
        resizable: false,
      }),
      TableRow,
      TableHeader,
      TableCell,
      getLinkExtension(),
      WebPreview.configure({
        editable: false,
        activity: activity,
      }),
      Flipcard.configure({
        editable: false,
        activity: activity,
      }),
      Scenarios.configure({
        editable: false,
        activity: activity,
      }),
      MagicBlock.configure({
        editable: false,
        activity: activity,
      }),
    ],
    content: content,
    immediatelyRender: false,
  })

  // Update content when it changes
  React.useEffect(() => {
    if (editor && content) {
      editor.commands.setContent(content)
    }
  }, [editor, content])

  if (!editor) {
    return <div className="p-4 text-gray-400">{t('editor.versioning.loading_preview')}</div>
  }

  return (
    <EditorOptionsProvider options={{ isEditable: false }}>
      <div className="editor-preview-wrapper">
        <EditorContent editor={editor} />
      </div>
    </EditorOptionsProvider>
  )
}

export default EditorPreview
