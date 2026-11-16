'use client'
import React, { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Check, CheckSquare, LinkSimple, ListBullets, ListNumbers, TextB, TextItalic, X } from '@phosphor-icons/react'
import type { NoteDoc } from '@services/notes/notes'

/**
 * The notes editor: a light TipTap setup with only what the server keeps
 * (bold, italic, strike, code, lists, checkboxes, quotes, links). Reports
 * every change; the panel debounces and saves.
 */
export function NoteEditor({
  initial,
  onChange,
  autoFocus = true,
  onBlurEmpty,
  footer,
}: {
  initial: NoteDoc
  onChange: (_doc: NoteDoc, _text: string) => void
  autoFocus?: boolean
  /** Called when focus leaves an empty note (a blank draft is dropped). */
  onBlurEmpty?: () => void
  footer?: React.ReactNode
}) {
  const { t } = useTranslation()
  const onChangeRef = useRef(onChange)
  const onBlurEmptyRef = useRef(onBlurEmpty)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
    onBlurEmptyRef.current = onBlurEmpty
  })

  const editor = useEditor({
    immediatelyRender: false,
    // Focus without scrolling: the panel is sticky, and scrolling a sticky
    // box's editor into view would jump the page back to the panel's origin.
    autofocus: false,
    onCreate: ({ editor }) => {
      if (autoFocus) editor.commands.focus('end', { scrollIntoView: false })
    },
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          protocols: ['http', 'https', 'mailto'],
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
          isAllowedUri: (url: string) => /^(https?:|mailto:|\/(?!\/)|#)/i.test(url),
        },
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      Placeholder.configure({ placeholder: t('notes.placeholder', { defaultValue: 'Write a note…' }) }),
    ],
    content: initial,
    editorProps: {
      attributes: {
        class: 'lh-note-editor outline-none min-h-[88px] text-sm leading-relaxed text-neutral-800',
        'aria-label': t('notes.editor_label', { defaultValue: 'Note' }),
        dir: 'auto',
      },
    },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getJSON() as NoteDoc, editor.getText()),
    onBlur: ({ editor, event }) => {
      // Moving into the toolbar or link field isn't leaving the note.
      const next = (event as FocusEvent)?.relatedTarget as Node | null
      // Nor is moving to the card's own controls or its actions menu.
      const card = rootRef.current?.closest('li')
      if (next && (rootRef.current?.contains(next) || card?.contains(next) || (next as Element).closest?.('[role="menu"]'))) return
      if (editor.isEmpty) onBlurEmptyRef.current?.()
    },
  })

  const rootRef = useRef<HTMLDivElement>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
            task: e.isActive('taskList'),
            link: e.isActive('link'),
          }
        : null,
  })

  const toggleLink = () => {
    if (!linkOpen) setLinkValue((editor?.getAttributes('link').href as string) || '')
    setLinkOpen(!linkOpen)
  }

  const applyLink = () => {
    if (!editor) return
    const href = linkValue.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!href) chain.unsetLink().run()
    else chain.setLink({ href: /^(https?:|mailto:|\/|#)/i.test(href) ? href : `https://${href}` }).run()
    setLinkOpen(false)
  }

  const tool = (label: string, isOn: boolean | undefined, run: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      aria-label={label}
      title={label}
      aria-pressed={!!isOn}
      className={`grid size-7 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15 ${
        isOn ? 'bg-neutral-900/[0.07] text-neutral-900' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'
      }`}
    >
      {icon}
    </button>
  )

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <div className="flex items-center gap-0.5 -ms-1" role="toolbar" aria-label={t('notes.formatting', { defaultValue: 'Formatting' })}>
        {tool(t('notes.bold', { defaultValue: 'Bold' }), active?.bold, () => editor?.chain().focus().toggleBold().run(), <TextB size={15} weight="bold" />)}
        {tool(t('notes.italic', { defaultValue: 'Italic' }), active?.italic, () => editor?.chain().focus().toggleItalic().run(), <TextItalic size={15} weight="bold" />)}
        <span className="mx-1 h-4 w-px bg-neutral-200" aria-hidden />
        {tool(t('notes.bullet_list', { defaultValue: 'Bulleted list' }), active?.bullet, () => editor?.chain().focus().toggleBulletList().run(), <ListBullets size={15} weight="bold" />)}
        {tool(t('notes.numbered_list', { defaultValue: 'Numbered list' }), active?.ordered, () => editor?.chain().focus().toggleOrderedList().run(), <ListNumbers size={15} weight="bold" />)}
        {tool(t('notes.checklist', { defaultValue: 'Checklist' }), active?.task, () => editor?.chain().focus().toggleTaskList().run(), <CheckSquare size={15} weight="bold" />)}
        <span className="mx-1 h-4 w-px bg-neutral-200" aria-hidden />
        {tool(t('notes.link', { defaultValue: 'Link' }), active?.link || linkOpen, toggleLink, <LinkSimple size={15} weight="bold" />)}
      </div>
      {linkOpen && (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setLinkOpen(false)
                editor?.commands.focus()
              }
            }}
            placeholder="https://"
            aria-label={t('notes.link_url', { defaultValue: 'Link address' })}
            className="h-8 min-w-0 flex-1 rounded-lg bg-white px-2.5 text-[13px] ring-1 ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
            dir="ltr"
          />
          <button type="button" onClick={applyLink} aria-label={t('notes.apply_link', { defaultValue: 'Apply link' })} className="grid size-8 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100">
            <Check size={15} weight="bold" />
          </button>
          <button type="button" onClick={() => setLinkOpen(false)} aria-label={t('common.cancel')} className="grid size-8 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100">
            <X size={14} weight="bold" />
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
      {footer}
    </div>
  )
}

export default NoteEditor
