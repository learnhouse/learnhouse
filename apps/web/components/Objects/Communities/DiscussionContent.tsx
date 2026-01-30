'use client'
import React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'

interface DiscussionContentProps {
  content: any
}

/**
 * Renders discussion content (JSON from tiptap) in read-only mode.
 * Falls back to plain text display if content is a string.
 */
export function DiscussionContent({ content }: DiscussionContentProps) {
  // Handle plain text content (legacy)
  if (typeof content === 'string') {
    return (
      <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
        {content}
      </p>
    )
  }

  // Handle empty content
  if (!content || (content.type === 'doc' && (!content.content || content.content.length === 0))) {
    return null
  }

  return <DiscussionContentEditor content={content} />
}

function DiscussionContentEditor({ content }: { content: any }) {
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
        openOnClick: true,
        HTMLAttributes: {
          class: 'discussion-link',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    ],
    content,
    editable: false,
    immediatelyRender: false,
  })

  if (!editor) {
    return null
  }

  return (
    <>
      <EditorContent editor={editor} className="discussion-content-readonly" />
      <style jsx global>{`
        .discussion-content-readonly .ProseMirror {
          outline: none;
        }

        .discussion-content-readonly .ProseMirror h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
          color: #111827;
        }

        .discussion-content-readonly .ProseMirror h3 {
          font-size: 1.1rem;
          font-weight: 600;
          margin-top: 0.75rem;
          margin-bottom: 0.5rem;
          color: #111827;
        }

        .discussion-content-readonly .ProseMirror p {
          margin-bottom: 0.5rem;
          line-height: 1.6;
          color: #374151;
        }

        .discussion-content-readonly .ProseMirror p:last-child {
          margin-bottom: 0;
        }

        .discussion-content-readonly .ProseMirror .discussion-bullet-list {
          list-style-type: disc;
          padding-left: 1.5rem;
          margin-bottom: 0.5rem;
          color: #374151;
        }

        .discussion-content-readonly .ProseMirror .discussion-ordered-list {
          list-style-type: decimal;
          padding-left: 1.5rem;
          margin-bottom: 0.5rem;
          color: #374151;
        }

        .discussion-content-readonly .ProseMirror li {
          margin-bottom: 0.25rem;
        }

        .discussion-content-readonly .ProseMirror .discussion-blockquote {
          border-left: 3px solid #d1d5db;
          padding-left: 1rem;
          color: #6b7280;
          font-style: italic;
          margin: 0.5rem 0;
        }

        .discussion-content-readonly .ProseMirror code {
          background-color: #f3f4f6;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-size: 0.875rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          color: #1f2937;
        }

        .discussion-content-readonly .ProseMirror .discussion-code-block {
          background-color: #1f2937;
          color: #e5e7eb;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          overflow-x: auto;
          margin: 0.5rem 0;
        }

        .discussion-content-readonly .ProseMirror .discussion-code-block code {
          background: none;
          padding: 0;
          color: inherit;
        }

        .discussion-content-readonly .ProseMirror .discussion-link {
          color: #2563eb;
          text-decoration: underline;
          cursor: pointer;
        }

        .discussion-content-readonly .ProseMirror .discussion-link:hover {
          color: #1d4ed8;
        }

        .discussion-content-readonly .ProseMirror strong {
          font-weight: 600;
        }

        .discussion-content-readonly .ProseMirror em {
          font-style: italic;
        }

        .discussion-content-readonly .ProseMirror s {
          text-decoration: line-through;
        }
      `}</style>
    </>
  )
}

export default DiscussionContent
