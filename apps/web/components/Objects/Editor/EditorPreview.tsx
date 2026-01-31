'use client'
import React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import styled from 'styled-components'
import EditorOptionsProvider from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'

// Extensions
import InfoCallout from './Extensions/Callout/Info/InfoCallout'
import WarningCallout from './Extensions/Callout/Warning/WarningCallout'
import ImageBlock from './Extensions/Image/ImageBlock'
import Youtube from '@tiptap/extension-youtube'
import VideoBlock from './Extensions/Video/VideoBlock'
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

// Lowlight
import { common, createLowlight } from 'lowlight'
const lowlight = createLowlight(common)
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import css from 'highlight.js/lib/languages/css'
import js from 'highlight.js/lib/languages/javascript'
import ts from 'highlight.js/lib/languages/typescript'
import html from 'highlight.js/lib/languages/xml'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'

interface EditorPreviewProps {
  content: any
  activity?: any
}

function EditorPreview({ content, activity }: EditorPreviewProps) {
  const { t } = useTranslation()

  // Register lowlight languages
  lowlight.register('html', html)
  lowlight.register('css', css)
  lowlight.register('js', js)
  lowlight.register('ts', ts)
  lowlight.register('python', python)
  lowlight.register('java', java)

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
      <PreviewWrapper>
        <EditorContent editor={editor} />
      </PreviewWrapper>
    </EditorOptionsProvider>
  )
}

const PreviewWrapper = styled.div`
  .ProseMirror {
    h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    h2 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    h3 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    h4 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    h5 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    a {
      color: #2563eb;
      text-decoration: underline;
      cursor: pointer;
    }

    p {
      margin-bottom: 8px;
    }

    &:focus {
      outline: none !important;
    }

    pre {
      background: #0d0d0d;
      border-radius: 0.5rem;
      color: #fff;
      font-family: 'JetBrainsMono', monospace;
      padding: 0.75rem 1rem;
      font-size: 0.8rem;

      code {
        background: none;
        color: inherit;
        padding: 0;
      }
    }

    ul,
    ol {
      padding: 0 1rem;
      padding-left: 20px;
    }

    ul {
      list-style-type: disc;
    }

    ol {
      list-style-type: decimal;
    }

    table {
      border-collapse: collapse;
      margin: 0;
      overflow: hidden;
      table-layout: fixed;
      width: 100%;

      td,
      th {
        border: 1px solid rgba(139, 139, 139, 0.4);
        box-sizing: border-box;
        min-width: 1em;
        padding: 6px 8px;
        position: relative;
        vertical-align: top;
      }

      th {
        background-color: rgba(217, 217, 217, 0.4);
        font-weight: bold;
        text-align: left;
      }
    }
  }

  iframe {
    border-radius: 6px;
    border: none;
    min-width: 200px;
    width: 100%;
    height: 300px;
    min-height: 200px;
    display: block;
  }
`

export default EditorPreview
