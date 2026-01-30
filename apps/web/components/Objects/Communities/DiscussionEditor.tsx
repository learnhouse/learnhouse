'use client'
import React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon, List, ListOrdered, Heading2, Quote } from 'lucide-react'

interface DiscussionEditorProps {
  content: any
  onChange: (content: any) => void
  placeholder?: string
  editable?: boolean
  minHeight?: string
}

export function DiscussionEditor({
  content,
  onChange,
  placeholder = 'Write your discussion...',
  editable = true,
  minHeight = '150px',
}: DiscussionEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable link since we configure it separately below
        link: false,
        heading: {
          levels: [2, 3],
        },
        bulletList: {
          HTMLAttributes: {
            class: 'discussion-bullet-list',
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: 'discussion-ordered-list',
          },
        },
        codeBlock: {
          HTMLAttributes: {
            class: 'discussion-code-block',
          },
        },
        blockquote: {
          HTMLAttributes: {
            class: 'discussion-blockquote',
          },
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'discussion-link',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: content || '',
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      onChange(json)
    },
  })

  if (!editor) {
    return null
  }

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl)

    if (url === null) {
      return
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const ToolbarButton = ({
    onClick,
    isActive,
    children,
    title,
  }: {
    onClick: () => void
    isActive?: boolean
    children: React.ReactNode
    title: string
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        isActive
          ? 'bg-gray-200 text-gray-900'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )

  return (
    <div className="discussion-editor">
      {editable && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-0.5 p-2 border-b border-gray-200 bg-gray-50 rounded-t-lg">
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive('bold')}
              title="Bold (Ctrl+B)"
            >
              <Bold size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive('italic')}
              title="Italic (Ctrl+I)"
            >
              <Italic size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={editor.isActive('strike')}
              title="Strikethrough"
            >
              <Strikethrough size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleCode().run()}
              isActive={editor.isActive('code')}
              title="Inline Code"
            >
              <Code size={16} />
            </ToolbarButton>

            <div className="w-px h-5 bg-gray-300 mx-1" />

            <ToolbarButton
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              isActive={editor.isActive('heading', { level: 2 })}
              title="Heading"
            >
              <Heading2 size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              isActive={editor.isActive('bulletList')}
              title="Bullet List"
            >
              <List size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              isActive={editor.isActive('orderedList')}
              title="Numbered List"
            >
              <ListOrdered size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              isActive={editor.isActive('blockquote')}
              title="Quote"
            >
              <Quote size={16} />
            </ToolbarButton>

            <div className="w-px h-5 bg-gray-300 mx-1" />

            <ToolbarButton
              onClick={setLink}
              isActive={editor.isActive('link')}
              title="Add Link"
            >
              <LinkIcon size={16} />
            </ToolbarButton>
          </div>
        </>
      )}

      {/* Editor Content */}
      <EditorContent
        editor={editor}
        className={`discussion-editor-content ${editable ? 'rounded-b-lg' : 'rounded-lg'}`}
        style={{ minHeight: editable ? minHeight : 'auto' }}
      />

      <style jsx global>{`
        .discussion-editor-content {
          border: 1px solid #e5e7eb;
          border-top: ${editable ? 'none' : '1px solid #e5e7eb'};
        }

        .discussion-editor-content .ProseMirror {
          padding: 12px 16px;
          outline: none;
          min-height: ${editable ? minHeight : 'auto'};
        }

        .discussion-editor-content .ProseMirror p.is-editor-empty:first-child::before {
          color: #9ca3af;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }

        .discussion-editor-content .ProseMirror h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }

        .discussion-editor-content .ProseMirror h3 {
          font-size: 1.1rem;
          font-weight: 600;
          margin-top: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .discussion-editor-content .ProseMirror p {
          margin-bottom: 0.5rem;
          line-height: 1.6;
        }

        .discussion-editor-content .ProseMirror .discussion-bullet-list {
          list-style-type: disc;
          padding-left: 1.5rem;
          margin-bottom: 0.5rem;
        }

        .discussion-editor-content .ProseMirror .discussion-ordered-list {
          list-style-type: decimal;
          padding-left: 1.5rem;
          margin-bottom: 0.5rem;
        }

        .discussion-editor-content .ProseMirror li {
          margin-bottom: 0.25rem;
        }

        .discussion-editor-content .ProseMirror .discussion-blockquote {
          border-left: 3px solid #e5e7eb;
          padding-left: 1rem;
          color: #6b7280;
          font-style: italic;
          margin: 0.5rem 0;
        }

        .discussion-editor-content .ProseMirror code {
          background-color: #f3f4f6;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-size: 0.875rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }

        .discussion-editor-content .ProseMirror .discussion-code-block {
          background-color: #1f2937;
          color: #e5e7eb;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          overflow-x: auto;
          margin: 0.5rem 0;
        }

        .discussion-editor-content .ProseMirror .discussion-code-block code {
          background: none;
          padding: 0;
          color: inherit;
        }

        .discussion-editor-content .ProseMirror .discussion-link {
          color: #2563eb;
          text-decoration: underline;
          cursor: pointer;
        }

        .discussion-editor-content .ProseMirror .discussion-link:hover {
          color: #1d4ed8;
        }

        .discussion-editor-content .ProseMirror strong {
          font-weight: 600;
        }

        .discussion-editor-content .ProseMirror em {
          font-style: italic;
        }

        .discussion-editor-content .ProseMirror s {
          text-decoration: line-through;
        }
      `}</style>
    </div>
  )
}

export default DiscussionEditor
