'use client'

import React, { useCallback } from 'react'
import { Editor } from '@tiptap/react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FontBoldIcon,
  FontItalicIcon,
  StrikethroughIcon,
  ListBulletIcon,
  TableIcon,
  DividerVerticalIcon,
  ChevronDownIcon,
  RowsIcon,
  ColumnsIcon,
  SectionIcon,
  ContainerIcon,
} from '@radix-ui/react-icons'
import {
  Code,
  Link2,
  List,
  ListOrdered,
  Quote,
  Minus,
  Code2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  ImagePlus,
} from 'lucide-react'

interface DocToolbarProps {
  editor: Editor | null
}

const DocToolbar = ({ editor }: DocToolbarProps) => {
  const [showTableMenu, setShowTableMenu] = React.useState(false)
  const [showListMenu, setShowListMenu] = React.useState(false)

  const setLink = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  if (!editor) return null

  const tableOptions = [
    { label: 'Insert table', icon: <TableIcon />, action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: 'Add row', icon: <RowsIcon />, action: () => editor.chain().focus().addRowAfter().run() },
    { label: 'Add column', icon: <ColumnsIcon />, action: () => editor.chain().focus().addColumnAfter().run() },
    { label: 'Delete row', icon: <SectionIcon />, action: () => editor.chain().focus().deleteRow().run() },
    { label: 'Delete column', icon: <ContainerIcon />, action: () => editor.chain().focus().deleteColumn().run() },
  ]

  const listOptions = [
    {
      label: 'Bullet list',
      icon: <List size={15} />,
      action: () => {
        if (editor.isActive('bulletList')) {
          editor.chain().focus().toggleBulletList().run()
        } else {
          editor.chain().focus().toggleOrderedList().run()
          editor.chain().focus().toggleBulletList().run()
        }
      },
    },
    {
      label: 'Ordered list',
      icon: <ListOrdered size={15} />,
      action: () => {
        if (editor.isActive('orderedList')) {
          editor.chain().focus().toggleOrderedList().run()
        } else {
          editor.chain().focus().toggleBulletList().run()
          editor.chain().focus().toggleOrderedList().run()
        }
      },
    },
  ]

  return (
    <div className="flex flex-row items-center justify-start flex-wrap gap-[7px] max-[1200px]:gap-[5px]">
      <div className="editor-tool-btn" onClick={() => editor.chain().focus().undo().run()}>
        <ArrowLeftIcon />
      </div>
      <div className="editor-tool-btn" onClick={() => editor.chain().focus().redo().run()}>
        <ArrowRightIcon />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`editor-tool-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
      >
        <FontBoldIcon />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`editor-tool-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
      >
        <FontItalicIcon />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`editor-tool-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
      >
        <StrikethroughIcon />
      </div>
      <div className="relative inline-block shrink-0">
        <div
          onClick={() => setShowListMenu(!showListMenu)}
          className={`editor-tool-btn ${showListMenu || editor.isActive('bulletList') || editor.isActive('orderedList') ? 'is-active' : ''}`}
        >
          <ListBulletIcon />
          <ChevronDownIcon />
        </div>
        {showListMenu && (
          <div className="editor-menu-dropdown">
            {listOptions.map((option, index) => (
              <div
                key={index}
                onClick={() => { option.action(); setShowListMenu(false) }}
                className={`editor-menu-item ${editor.isActive(index === 0 ? 'bulletList' : 'orderedList') ? 'is-active' : ''}`}
              >
                <span className="icon">{option.icon}</span>
                <span className="label">{option.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <select
        className="editor-tool-select"
        value={
          editor.isActive('heading', { level: 1 }) ? '1' :
          editor.isActive('heading', { level: 2 }) ? '2' :
          editor.isActive('heading', { level: 3 }) ? '3' :
          editor.isActive('heading', { level: 4 }) ? '4' : '0'
        }
        onChange={(e) => {
          const value = e.target.value
          if (value === '0') {
            editor.chain().focus().setParagraph().run()
          } else {
            editor.chain().focus().toggleHeading({ level: parseInt(value) as 1 | 2 | 3 | 4 }).run()
          }
        }}
      >
        <option value="0">Paragraph</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
        <option value="4">Heading 4</option>
      </select>
      <div className="relative inline-block shrink-0">
        <div
          onClick={() => setShowTableMenu(!showTableMenu)}
          className={`editor-tool-btn ${showTableMenu ? 'is-active' : ''}`}
        >
          <TableIcon width={18} />
          <ChevronDownIcon />
        </div>
        {showTableMenu && (
          <div className="editor-menu-dropdown">
            {tableOptions.map((option, index) => (
              <div
                key={index}
                onClick={() => { option.action(); setShowTableMenu(false) }}
                className="editor-menu-item"
              >
                <span className="icon">{option.icon}</span>
                <span className="label">{option.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <DividerVerticalIcon
        style={{ marginTop: 'auto', marginBottom: 'auto', color: 'grey' }}
      />
      <div
        className="editor-tool-btn editor-tool-btn-info"
        onClick={() => editor.chain().focus().setDocCallout({ variant: 'info' }).run()}
      >
        <AlertCircle size={15} />
      </div>
      <div
        className="editor-tool-btn editor-tool-btn-warning"
        onClick={() => editor.chain().focus().setDocCallout({ variant: 'warning' }).run()}
      >
        <AlertTriangle size={15} />
      </div>
      <div
        className="editor-tool-btn editor-tool-btn-success"
        onClick={() => editor.chain().focus().setDocCallout({ variant: 'success' }).run()}
      >
        <CheckCircle2 size={15} />
      </div>
      <div
        className="editor-tool-btn editor-tool-btn-tip"
        onClick={() => editor.chain().focus().setDocCallout({ variant: 'tip' }).run()}
      >
        <Lightbulb size={15} />
      </div>
      <div
        onClick={setLink}
        className={`editor-tool-btn editor-tool-btn-link ${editor.isActive('link') ? 'is-active' : ''}`}
      >
        <Link2 size={15} />
      </div>
      <div
        className="editor-tool-btn editor-tool-btn-media"
        onClick={() => editor.chain().focus().setDocImage({ src: '' }).run()}
      >
        <ImagePlus size={15} />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={`editor-tool-btn editor-tool-btn-code ${editor.isActive('codeBlock') ? 'is-active' : ''}`}
      >
        <Code size={15} />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`editor-tool-btn ${editor.isActive('blockquote') ? 'is-active' : ''}`}
      >
        <Quote size={15} />
      </div>
      <div
        className="editor-tool-btn"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={15} />
      </div>
    </div>
  )
}

export default DocToolbar
