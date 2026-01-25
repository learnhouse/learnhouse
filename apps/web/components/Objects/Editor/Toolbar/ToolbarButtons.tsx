import styled from 'styled-components'
import {
  FontBoldIcon,
  FontItalicIcon,
  StrikethroughIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  DividerVerticalIcon,
  ListBulletIcon,
  TableIcon,
  RowsIcon,
  ColumnsIcon,
  SectionIcon,
  ContainerIcon,
  ChevronDownIcon,
} from '@radix-ui/react-icons'
import {
  AlertCircle,
  AlertTriangle,
  BadgeHelp,
  Code,
  Cuboid,
  FileText,
  ImagePlus,
  Link2,
  MousePointerClick,
  RotateCw,
  Sigma,
  Tags,
  User,
  Video,
  List,
  ListOrdered,
  Globe,
  GitBranch,
} from 'lucide-react'
import { SiYoutube } from '@icons-pack/react-simple-icons'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import React from 'react'
import LinkInputTooltip from './LinkInputTooltip'

export const ToolbarButtons = ({ editor, props }: any) => {
  const [showTableMenu, setShowTableMenu] = React.useState(false)
  const [showListMenu, setShowListMenu] = React.useState(false)
  const [showLinkInput, setShowLinkInput] = React.useState(false)
  const linkButtonRef = React.useRef<HTMLDivElement>(null)

  if (!editor) {
    return null
  }


  const tableOptions = [
    {
      label: 'Insert new table (3×3)',
      icon: <TableIcon />,
      action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
    {
      label: 'Add row below',
      icon: <RowsIcon />,
      action: () => editor.chain().focus().addRowAfter().run()
    },
    {
      label: 'Add column right',
      icon: <ColumnsIcon />,
      action: () => editor.chain().focus().addColumnAfter().run()
    },
    {
      label: 'Delete current row',
      icon: <SectionIcon />,
      action: () => editor.chain().focus().deleteRow().run()
    },
    {
      label: 'Delete current column',
      icon: <ContainerIcon />,
      action: () => editor.chain().focus().deleteColumn().run()
    }
  ]

  const listOptions = [
    {
      label: 'Bullet List',
      icon: <List size={15} />,
      action: () => {
        if (editor.isActive('bulletList')) {
          editor.chain().focus().toggleBulletList().run()
        } else {
          editor.chain().focus().toggleOrderedList().run()
          editor.chain().focus().toggleBulletList().run()
        }
      }
    },
    {
      label: 'Ordered List',
      icon: <ListOrdered size={15} />,
      action: () => {
        if (editor.isActive('orderedList')) {
          editor.chain().focus().toggleOrderedList().run()
        } else {
          editor.chain().focus().toggleBulletList().run()
          editor.chain().focus().toggleOrderedList().run()
        }
      }
    }
  ]

  const handleLinkClick = () => {
    // Store the current selection
    const { from, to } = editor.state.selection
    
    if (editor.isActive('link')) {
      const currentLink = editor.getAttributes('link')
      setShowLinkInput(true)
    } else {
      setShowLinkInput(true)
    }

    // Restore the selection after a small delay to ensure the tooltip is rendered
    setTimeout(() => {
      editor.commands.setTextSelection({ from, to })
    }, 0)
  }

  const getCurrentLinkUrl = () => {
    if (editor.isActive('link')) {
      return editor.getAttributes('link').href
    }
    return ''
  }

  const handleLinkSave = (url: string) => {
    editor
      .chain()
      .focus()
      .setLink({ 
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer'
      })
      .run()
    setShowLinkInput(false)
  }

  const handleLinkCancel = () => {
    setShowLinkInput(false)
  }

  return (
    <ToolButtonsWrapper>
      <ToolBtn onClick={() => editor.chain().focus().undo().run()} aria-label="Undo last action">
        <ArrowLeftIcon />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().redo().run()} aria-label="Redo last action">
        <ArrowRightIcon />
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive('bold') ? 'is-active' : ''}
        aria-label="Toggle bold formatting"
      >
        <FontBoldIcon />
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive('italic') ? 'is-active' : ''}
        aria-label="Toggle italic formatting"
      >
        <FontItalicIcon />
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={editor.isActive('strike') ? 'is-active' : ''}
        aria-label="Toggle strikethrough formatting"
      >
        <StrikethroughIcon />
      </ToolBtn>
      <ListMenuWrapper>
        <ToolBtn
          onClick={() => setShowListMenu(!showListMenu)}
          className={showListMenu || editor.isActive('bulletList') || editor.isActive('orderedList') ? 'is-active' : ''}
          aria-label="Insert list"
        >
          <ListBulletIcon />
          <ChevronDownIcon />
        </ToolBtn>
        {showListMenu && (
          <ListDropdown>
            {listOptions.map((option, index) => (
              <ListMenuItem 
                key={index}
                onClick={() => {
                  option.action()
                  setShowListMenu(false)
                }}
                className={editor.isActive(option.label === 'Bullet List' ? 'bulletList' : 'orderedList') ? 'is-active' : ''}
              >
                <span className="icon">{option.icon}</span>
                <span className="label">{option.label}</span>
              </ListMenuItem>
            ))}
          </ListDropdown>
        )}
      </ListMenuWrapper>
      <ToolSelect
        value={
          editor.isActive('heading', { level: 1 }) ? "1" :
          editor.isActive('heading', { level: 2 }) ? "2" :
          editor.isActive('heading', { level: 3 }) ? "3" :
          editor.isActive('heading', { level: 4 }) ? "4" :
          editor.isActive('heading', { level: 5 }) ? "5" :
          editor.isActive('heading', { level: 6 }) ? "6" : "0"
        }
        onChange={(e) => {
          const value = e.target.value;
          if (value === "0") {
            editor.chain().focus().setParagraph().run();
          } else {
            editor.chain().focus().toggleHeading({ level: parseInt(value) }).run();
          }
        }}
      >
        <option value="0">Paragraph</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
        <option value="4">Heading 4</option>
        <option value="5">Heading 5</option>
        <option value="6">Heading 6</option>
      </ToolSelect>
      <TableMenuWrapper>
        <ToolBtn
          onClick={() => setShowTableMenu(!showTableMenu)}
          className={showTableMenu ? 'is-active' : ''}
          aria-label="Insert table"
        >
          <TableIcon width={18} />
          <ChevronDownIcon  />
        </ToolBtn>
        {showTableMenu && (
          <TableDropdown>
            {tableOptions.map((option, index) => (
              <TableMenuItem 
                key={index}
                onClick={() => {
                  option.action()
                  setShowTableMenu(false)
                }}
              >
                <span className="icon">{option.icon}</span>
                <span className="label">{option.label}</span>
              </TableMenuItem>
            ))}
          </TableDropdown>
        )}
      </TableMenuWrapper>
      <DividerVerticalIcon
        style={{ marginTop: 'auto', marginBottom: 'auto', color: 'grey' }}
      />
      <ToolTip content={'Info Callout'}>
        <ToolBtnInfo
          onClick={() => editor.chain().focus().toggleNode('calloutInfo').run()}
          aria-label="Insert info callout"
        >
          <AlertCircle size={15} />
        </ToolBtnInfo>
      </ToolTip>
      <ToolTip content={'Warning Callout'}>
        <ToolBtnWarning
          onClick={() =>
            editor.chain().focus().toggleNode('calloutWarning').run()
          }
          aria-label="Insert warning callout"
        >
          <AlertTriangle size={15} />
        </ToolBtnWarning>
      </ToolTip>
      <ToolTip content={'Link'}>
        <div style={{ position: 'relative' }}>
          <ToolBtnLink
            ref={linkButtonRef}
            onClick={handleLinkClick}
            className={editor.isActive('link') ? 'is-active' : ''}
            aria-label="Insert or edit link"
          >
            <Link2 size={15} />
          </ToolBtnLink>
          {showLinkInput && (
            <LinkInputTooltip
              onSave={handleLinkSave}
              onCancel={handleLinkCancel}
              currentUrl={getCurrentLinkUrl()}
            />
          )}
        </div>
      </ToolTip>
      <ToolTip content={'Image'}>
        <ToolBtnMedia
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockImage',
              })
              .run()
          }
          aria-label="Insert image"
        >
          <ImagePlus size={15} />
        </ToolBtnMedia>
      </ToolTip>
      <ToolTip content={'Video'}>
        <ToolBtnMedia
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockVideo',
              })
              .run()
          }
          aria-label="Insert video"
        >
          <Video size={15} />
        </ToolBtnMedia>
      </ToolTip>
      <ToolTip content={'YouTube video'}>
        <ToolBtnMedia onClick={() => editor.chain().focus().insertContent({ type: 'blockEmbed' }).run()} aria-label="Insert YouTube video">
          <SiYoutube size={15} />
        </ToolBtnMedia>
      </ToolTip>
      <ToolTip content={'Math Equation (LaTeX)'}>
        <ToolBtnMath
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockMathEquation',
              })
              .run()
          }
          aria-label="Insert math equation (LaTeX)"
        >
          <Sigma size={15} />
        </ToolBtnMath>
      </ToolTip>
      <ToolTip content={'PDF Document'}>
        <ToolBtnDocument
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockPDF',
              })
              .run()
          }
          aria-label="Insert PDF document"
        >
          <FileText size={15} />
        </ToolBtnDocument>
      </ToolTip>
      <ToolTip content={'Interactive Quiz'}>
        <ToolBtnInteractive
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockQuiz',
              })
              .run()
          }
          aria-label="Insert interactive quiz"
        >
          <BadgeHelp size={15} />
        </ToolBtnInteractive>
      </ToolTip>
      <ToolTip content={'Code Block'}>
        <ToolBtnCode
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={editor.isActive('codeBlock') ? 'is-active' : ''}
          aria-label="Insert code block"
        >
          <Code size={15} />
        </ToolBtnCode>
      </ToolTip>
      <ToolTip content={'External Object (Embed)'}>
        <ToolBtnEmbed
          onClick={() => editor.chain().focus().insertContent({ type: 'blockEmbed' }).run()}
          aria-label="Insert external object or embed"
        >
          <Cuboid size={15} />
        </ToolBtnEmbed>
      </ToolTip>
      <ToolTip content={'Badges'}>
        <ToolBtnBadge
          onClick={() => editor.chain().focus().insertContent({
            type: 'badge',
            content: [
              {
                type: 'text',
                text: 'This is a Badge'
              }
            ]
          }).run()}
          aria-label="Insert badge"
        >
          <Tags size={15} />
        </ToolBtnBadge>
      </ToolTip>
      <ToolTip content={'Button'}>
        <ToolBtnInteractive
          onClick={() => editor.chain().focus().insertContent({
            type: 'button',
            content: [
              {
                type: 'text',
                text: 'Click me'
              }
            ]
          }).run()}
          aria-label="Insert button"
        >
          <MousePointerClick size={15} />
        </ToolBtnInteractive>
      </ToolTip>
      <ToolTip content={'User'}>
        <ToolBtnUser
          onClick={() => editor.chain().focus().insertContent({ type: 'blockUser' }).run()}
          aria-label="Insert user reference"
        >
          <User size={15} />
        </ToolBtnUser>
      </ToolTip>
      <ToolTip content={'Web Preview'}>
        <ToolBtnWeb
          onClick={() =>
            editor.chain().focus().insertContent({
              type: 'blockWebPreview',
            }).run()
          }
          aria-label="Insert web preview"
        >
          <Globe size={15} />
        </ToolBtnWeb>
      </ToolTip>
      <ToolTip content={'Flipcard'}>
        <ToolBtnInteractive
          onClick={() =>
            editor.chain().focus().insertContent({
              type: 'flipcard',
              attrs: {
                question: 'Click to reveal the answer',
                answer: 'This is the answer',
                color: 'blue',
                alignment: 'center',
                size: 'medium'
              }
            }).run()
          }
          aria-label="Insert flipcard"
        >
          <RotateCw size={15} />
        </ToolBtnInteractive>
      </ToolTip>
      <ToolTip content={'Interactive Scenarios'}>
        <ToolBtnInteractive
          onClick={() =>
            editor.chain().focus().insertContent({
              type: 'scenarios',
              attrs: {
                title: 'Interactive Scenario',
                scenarios: [
                  {
                    id: '1',
                    text: 'Welcome to this interactive scenario. What would you like to do?',
                    imageUrl: '',
                    options: [
                      { id: 'opt1', text: 'Continue exploring', nextScenarioId: '2' },
                      { id: 'opt2', text: 'Learn more about the topic', nextScenarioId: '3' }
                    ]
                  },
                  {
                    id: '2',
                    text: 'Great choice! You are now exploring further. What\'s your next step?',
                    imageUrl: '',
                    options: [
                      { id: 'opt3', text: 'Go back to start', nextScenarioId: '1' },
                      { id: 'opt4', text: 'Finish scenario', nextScenarioId: null }
                    ]
                  },
                  {
                    id: '3',
                    text: 'Here\'s more information about the topic. This helps you understand better.',
                    imageUrl: '',
                    options: [
                      { id: 'opt5', text: 'Go back to start', nextScenarioId: '1' },
                      { id: 'opt6', text: 'Finish scenario', nextScenarioId: null }
                    ]
                  }
                ],
                currentScenarioId: '1'
              }
            }).run()
          }
          aria-label="Insert interactive scenarios"
        >
          <GitBranch size={15} />
        </ToolBtnInteractive>
      </ToolTip>
    </ToolButtonsWrapper>
  )
}

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
  box-shadow: 0 4px 6px -1px rgba(209, 213, 219, 0.25), 0 2px 4px -2px rgba(209, 213, 219, 0.25);
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

// Info Callout button - blue tint
const ToolBtnInfo = styled(ToolBtn)`
  background: rgba(59, 130, 246, 0.06);
  color: rgb(59, 130, 246);
  outline: 1px solid rgba(59, 130, 246, 0.1);

  &:hover {
    background: rgba(59, 130, 246, 0.12);
  }
`

// Warning Callout button - amber tint
const ToolBtnWarning = styled(ToolBtn)`
  background: rgba(245, 158, 11, 0.06);
  color: rgb(217, 119, 6);
  outline: 1px solid rgba(245, 158, 11, 0.12);

  &:hover {
    background: rgba(245, 158, 11, 0.12);
  }
`

// Link button - blue tint
const ToolBtnLink = styled(ToolBtn)`
  background: rgba(59, 130, 246, 0.06);
  color: rgb(59, 130, 246);
  outline: 1px solid rgba(59, 130, 246, 0.1);

  &.is-active {
    background: rgba(59, 130, 246, 0.18);
    color: rgb(37, 99, 235);
    outline: 1px solid rgba(59, 130, 246, 0.25);

    &:hover {
      background: rgba(59, 130, 246, 0.24);
    }
  }

  &:hover {
    background: rgba(59, 130, 246, 0.12);
  }
`

// Media buttons (Image, Video, YouTube) - purple/violet tint
const ToolBtnMedia = styled(ToolBtn)`
  background: rgba(139, 92, 246, 0.06);
  color: rgb(124, 58, 237);
  outline: 1px solid rgba(139, 92, 246, 0.1);

  &:hover {
    background: rgba(139, 92, 246, 0.12);
  }
`

// Math Equation button - amber/orange tint
const ToolBtnMath = styled(ToolBtn)`
  background: rgba(251, 146, 60, 0.06);
  color: rgb(234, 88, 12);
  outline: 1px solid rgba(251, 146, 60, 0.12);

  &:hover {
    background: rgba(251, 146, 60, 0.12);
  }
`

// PDF/Document button - rose tint
const ToolBtnDocument = styled(ToolBtn)`
  background: rgba(244, 63, 94, 0.06);
  color: rgb(244, 63, 94);
  outline: 1px solid rgba(244, 63, 94, 0.1);

  &:hover {
    background: rgba(244, 63, 94, 0.12);
  }
`

// Interactive buttons (Quiz, Flipcard, Scenarios, Button) - green tint
const ToolBtnInteractive = styled(ToolBtn)`
  background: rgba(34, 197, 94, 0.06);
  color: rgb(22, 163, 74);
  outline: 1px solid rgba(34, 197, 94, 0.1);

  &:hover {
    background: rgba(34, 197, 94, 0.12);
  }
`

// Code button - slate tint
const ToolBtnCode = styled(ToolBtn)`
  background: rgba(100, 116, 139, 0.06);
  color: rgb(71, 85, 105);
  outline: 1px solid rgba(100, 116, 139, 0.1);

  &.is-active {
    background: rgba(100, 116, 139, 0.18);
    color: rgb(51, 65, 85);
    outline: 1px solid rgba(100, 116, 139, 0.25);

    &:hover {
      background: rgba(100, 116, 139, 0.24);
    }
  }

  &:hover {
    background: rgba(100, 116, 139, 0.12);
  }
`

// Embed/External button - cyan/teal tint
const ToolBtnEmbed = styled(ToolBtn)`
  background: rgba(20, 184, 166, 0.06);
  color: rgb(13, 148, 136);
  outline: 1px solid rgba(20, 184, 166, 0.1);

  &:hover {
    background: rgba(20, 184, 166, 0.12);
  }
`

// Badges button - pink tint
const ToolBtnBadge = styled(ToolBtn)`
  background: rgba(236, 72, 153, 0.06);
  color: rgb(219, 39, 119);
  outline: 1px solid rgba(236, 72, 153, 0.1);

  &:hover {
    background: rgba(236, 72, 153, 0.12);
  }
`

// User button - indigo tint
const ToolBtnUser = styled(ToolBtn)`
  background: rgba(99, 102, 241, 0.06);
  color: rgb(79, 70, 229);
  outline: 1px solid rgba(99, 102, 241, 0.1);

  &:hover {
    background: rgba(99, 102, 241, 0.12);
  }
`

// Web Preview button - sky blue tint
const ToolBtnWeb = styled(ToolBtn)`
  background: rgba(14, 165, 233, 0.06);
  color: rgb(2, 132, 199);
  outline: 1px solid rgba(14, 165, 233, 0.1);

  &:hover {
    background: rgba(14, 165, 233, 0.12);
  }
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
  font-family: 'DM Sans';
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
  box-shadow: 0 4px 6px -1px rgba(209, 213, 219, 0.25), 0 2px 4px -2px rgba(209, 213, 219, 0.25);
  outline: 1px solid rgba(229, 231, 235, 0.4);

  &:hover {
    background-color: #f9fafb;
  }

  &:focus {
    outline: 1px solid rgba(107, 114, 128, 0.3);
  }

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

const TableDropdown = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  background: white;
  border-radius: 6px;
  z-index: 1000;
  min-width: 180px;
  margin-top: 4px;
  padding: 4px;
  box-shadow: 0 4px 6px -1px rgba(209, 213, 219, 0.25), 0 2px 4px -2px rgba(209, 213, 219, 0.25);
  outline: 1px solid rgba(229, 231, 235, 0.4);
`

const TableMenuItem = styled.div`
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s;
  border-radius: 4px;
  color: #4b5563;

  &:hover {
    background: rgba(243, 244, 246, 1);
  }

  .icon {
    margin-right: 8px;
    display: flex;
    align-items: center;
    color: #6b7280;
  }

  .label {
    font-size: 12px;
    font-family: 'DM Sans';
  }
`

const ListMenuWrapper = styled.div`
  position: relative;
  display: inline-block;
  flex-shrink: 0;
`

const ListDropdown = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  background: white;
  border-radius: 6px;
  z-index: 1000;
  min-width: 180px;
  margin-top: 4px;
  padding: 4px;
  box-shadow: 0 4px 6px -1px rgba(209, 213, 219, 0.25), 0 2px 4px -2px rgba(209, 213, 219, 0.25);
  outline: 1px solid rgba(229, 231, 235, 0.4);
`

const ListMenuItem = styled.div`
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s;
  border-radius: 4px;
  color: #4b5563;

  &:hover {
    background: rgba(243, 244, 246, 1);
  }

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

  &.is-active .icon {
    color: #374151;
  }

  .label {
    font-size: 12px;
    font-family: 'DM Sans';
  }
`