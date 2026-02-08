'use client'

import React, { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { DocSlashCommands } from './SlashCommands/DocSlashCommands'
import { DocCallout } from './Extensions/DocCallout/DocCallout'
import { DocImage } from './Extensions/DocImage/DocImage'

interface DocTiptapEditorProps {
  content: any
  onUpdate: (json: any) => void
  onEditorReady?: (editor: any) => void
}

const DocTiptapEditor = ({ content, onUpdate, onEditorReady }: DocTiptapEditorProps) => {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline cursor-pointer',
        },
      }),
      Placeholder.configure({
        placeholder: 'Type / for commands...',
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      DocSlashCommands,
      DocCallout,
      DocImage,
    ],
    content: content || undefined,
    onUpdate: ({ editor }) => {
      onUpdate(editor.getJSON())
    },
    editorProps: {
      attributes: {
        class: 'doc-tiptap-editor focus:outline-none min-h-[400px] px-5 py-5',
      },
    },
  })

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor)
    }
  }, [editor, onEditorReady])

  return <EditorContent editor={editor} />
}

export default DocTiptapEditor
