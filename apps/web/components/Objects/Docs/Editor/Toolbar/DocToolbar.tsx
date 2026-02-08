'use client'

import React, { useCallback } from 'react'
import styled from 'styled-components'
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
    <ToolButtonsWrapper>
      <ToolBtn onClick={() => editor.chain().focus().undo().run()}>
        <ArrowLeftIcon />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().redo().run()}>
        <ArrowRightIcon />
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive('bold') ? 'is-active' : ''}
      >
        <FontBoldIcon />
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive('italic') ? 'is-active' : ''}
      >
        <FontItalicIcon />
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={editor.isActive('strike') ? 'is-active' : ''}
      >
        <StrikethroughIcon />
      </ToolBtn>
      <ListMenuWrapper>
        <ToolBtn
          onClick={() => setShowListMenu(!showListMenu)}
          className={showListMenu || editor.isActive('bulletList') || editor.isActive('orderedList') ? 'is-active' : ''}
        >
          <ListBulletIcon />
          <ChevronDownIcon />
        </ToolBtn>
        {showListMenu && (
          <MenuDropdown>
            {listOptions.map((option, index) => (
              <MenuItem
                key={index}
                onClick={() => { option.action(); setShowListMenu(false) }}
                className={editor.isActive(index === 0 ? 'bulletList' : 'orderedList') ? 'is-active' : ''}
              >
                <span className="icon">{option.icon}</span>
                <span className="label">{option.label}</span>
              </MenuItem>
            ))}
          </MenuDropdown>
        )}
      </ListMenuWrapper>
      <ToolSelect
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
      </ToolSelect>
      <TableMenuWrapper>
        <ToolBtn
          onClick={() => setShowTableMenu(!showTableMenu)}
          className={showTableMenu ? 'is-active' : ''}
        >
          <TableIcon width={18} />
          <ChevronDownIcon />
        </ToolBtn>
        {showTableMenu && (
          <MenuDropdown>
            {tableOptions.map((option, index) => (
              <MenuItem
                key={index}
                onClick={() => { option.action(); setShowTableMenu(false) }}
              >
                <span className="icon">{option.icon}</span>
                <span className="label">{option.label}</span>
              </MenuItem>
            ))}
          </MenuDropdown>
        )}
      </TableMenuWrapper>
      <DividerVerticalIcon
        style={{ marginTop: 'auto', marginBottom: 'auto', color: 'grey' }}
      />
      <ToolBtnInfo
        onClick={() => editor.chain().focus().setDocCallout({ variant: 'info' }).run()}
      >
        <AlertCircle size={15} />
      </ToolBtnInfo>
      <ToolBtnWarning
        onClick={() => editor.chain().focus().setDocCallout({ variant: 'warning' }).run()}
      >
        <AlertTriangle size={15} />
      </ToolBtnWarning>
      <ToolBtnSuccess
        onClick={() => editor.chain().focus().setDocCallout({ variant: 'success' }).run()}
      >
        <CheckCircle2 size={15} />
      </ToolBtnSuccess>
      <ToolBtnTip
        onClick={() => editor.chain().focus().setDocCallout({ variant: 'tip' }).run()}
      >
        <Lightbulb size={15} />
      </ToolBtnTip>
      <ToolBtnLink
        onClick={setLink}
        className={editor.isActive('link') ? 'is-active' : ''}
      >
        <Link2 size={15} />
      </ToolBtnLink>
      <ToolBtnMedia
        onClick={() => editor.chain().focus().setDocImage({ src: '' }).run()}
      >
        <ImagePlus size={15} />
      </ToolBtnMedia>
      <ToolBtnCode
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={editor.isActive('codeBlock') ? 'is-active' : ''}
      >
        <Code size={15} />
      </ToolBtnCode>
      <ToolBtn
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={editor.isActive('blockquote') ? 'is-active' : ''}
      >
        <Quote size={15} />
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={15} />
      </ToolBtn>
    </ToolButtonsWrapper>
  )
}

/* ─── Styled Components (matching activity editor ToolbarButtons.tsx) ─── */

const ToolButtonsWrapper = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 7px;

  @media (max-width: 1200px) {
    gap: 5px;
  }
`

const ToolBtn = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 6px;
  min-width: 25px;
  height: 25px;
  padding: 5px;
  transition: all 0.2s ease-in-out;
  flex-shrink: 0;
  color: #6b7280;
  box-shadow: 0 4px 6px -1px rgba(209, 213, 219, 0.25),
    0 2px 4px -2px rgba(209, 213, 219, 0.25);
  outline: 1px solid rgba(229, 231, 235, 0.4);

  svg {
    padding: 1px;
  }

  &.is-active {
    background: #f3f4f6;
    color: #1f2937;
    outline: 1px solid rgba(107, 114, 128, 0.3);

    &:hover {
      background: #e5e7eb;
      cursor: pointer;
    }
  }

  &:hover {
    background: #f9fafb;
    cursor: pointer;
  }

  @media (max-width: 1200px) {
    min-width: 24px;
    height: 24px;
    padding: 4px;
  }
`

const ToolBtnInfo = styled(ToolBtn)`
  background: rgba(59, 130, 246, 0.06);
  color: rgb(59, 130, 246);
  outline: 1px solid rgba(59, 130, 246, 0.1);
  &:hover { background: rgba(59, 130, 246, 0.12); }
`

const ToolBtnWarning = styled(ToolBtn)`
  background: rgba(245, 158, 11, 0.06);
  color: rgb(217, 119, 6);
  outline: 1px solid rgba(245, 158, 11, 0.12);
  &:hover { background: rgba(245, 158, 11, 0.12); }
`

const ToolBtnSuccess = styled(ToolBtn)`
  background: rgba(34, 197, 94, 0.06);
  color: rgb(22, 163, 74);
  outline: 1px solid rgba(34, 197, 94, 0.1);
  &:hover { background: rgba(34, 197, 94, 0.12); }
`

const ToolBtnTip = styled(ToolBtn)`
  background: rgba(139, 92, 246, 0.06);
  color: rgb(124, 58, 237);
  outline: 1px solid rgba(139, 92, 246, 0.1);
  &:hover { background: rgba(139, 92, 246, 0.12); }
`

const ToolBtnLink = styled(ToolBtn)`
  background: rgba(59, 130, 246, 0.06);
  color: rgb(59, 130, 246);
  outline: 1px solid rgba(59, 130, 246, 0.1);

  &.is-active {
    background: rgba(59, 130, 246, 0.18);
    color: rgb(37, 99, 235);
    outline: 1px solid rgba(59, 130, 246, 0.25);
    &:hover { background: rgba(59, 130, 246, 0.24); }
  }

  &:hover { background: rgba(59, 130, 246, 0.12); }
`

const ToolBtnMedia = styled(ToolBtn)`
  background: rgba(139, 92, 246, 0.06);
  color: rgb(124, 58, 237);
  outline: 1px solid rgba(139, 92, 246, 0.1);
  &:hover { background: rgba(139, 92, 246, 0.12); }
`

const ToolBtnCode = styled(ToolBtn)`
  background: rgba(100, 116, 139, 0.06);
  color: rgb(71, 85, 105);
  outline: 1px solid rgba(100, 116, 139, 0.1);

  &.is-active {
    background: rgba(100, 116, 139, 0.18);
    color: rgb(51, 65, 85);
    outline: 1px solid rgba(100, 116, 139, 0.25);
    &:hover { background: rgba(100, 116, 139, 0.24); }
  }

  &:hover { background: rgba(100, 116, 139, 0.12); }
`

const ToolSelect = styled.select`
  display: flex;
  background-color: white;
  border-radius: 6px;
  width: 120px;
  border: none;
  height: 25px;
  padding: 2px 5px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  color: #6b7280;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 5px center;
  background-size: 12px;
  padding-right: 20px;
  flex-shrink: 0;
  transition: all 0.2s ease-in-out;
  box-shadow: 0 4px 6px -1px rgba(209, 213, 219, 0.25),
    0 2px 4px -2px rgba(209, 213, 219, 0.25);
  outline: 1px solid rgba(229, 231, 235, 0.4);

  &:hover { background-color: #f9fafb; }
  &:focus { outline: 1px solid rgba(107, 114, 128, 0.3); }

  @media (max-width: 1200px) {
    width: 100px;
    height: 24px;
    font-size: 10px;
  }
`

const TableMenuWrapper = styled.div`
  position: relative;
  display: inline-block;
  flex-shrink: 0;
`

const ListMenuWrapper = styled.div`
  position: relative;
  display: inline-block;
  flex-shrink: 0;
`

const MenuDropdown = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  background: white;
  border-radius: 6px;
  z-index: var(--z-tooltip);
  min-width: 180px;
  margin-top: 4px;
  padding: 4px;
  box-shadow: 0 4px 6px -1px rgba(209, 213, 219, 0.25),
    0 2px 4px -2px rgba(209, 213, 219, 0.25);
  outline: 1px solid rgba(229, 231, 235, 0.4);
`

const MenuItem = styled.div`
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s;
  border-radius: 4px;
  color: #4b5563;

  &:hover { background: rgba(243, 244, 246, 1); }

  &.is-active {
    background: rgba(243, 244, 246, 1);
    color: #111827;
    font-weight: 500;
  }

  .icon {
    margin-right: 8px;
    display: flex;
    align-items: center;
    color: #6b7280;
  }

  &.is-active .icon { color: #374151; }

  .label {
    font-size: 12px;
    font-family: inherit;
  }
`

export default DocToolbar
