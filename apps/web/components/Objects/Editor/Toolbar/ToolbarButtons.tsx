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
  Lightbulb,
  MousePointerClick,
  Sigma,
  Table,
  Tag,
  Tags,
  Video,
} from 'lucide-react'
import { SiYoutube } from '@icons-pack/react-simple-icons'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import React from 'react'

export const ToolbarButtons = ({ editor, props }: any) => {
  const [showTableMenu, setShowTableMenu] = React.useState(false)

  if (!editor) {
    return null
  }

  // YouTube extension
  const addYoutubeVideo = () => {
    const url = prompt('Enter YouTube URL')

    if (url) {
      editor.commands.setYoutubeVideo({
        src: url,
        width: 640,
        height: 480,
      })
    }
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
      <ToolBtn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive('orderedList') ? 'is-active' : ''}
      >
        <ListBulletIcon />
      </ToolBtn>
      <ToolSelect
        onChange={(e) =>
          editor
            .chain()
            .focus()
            .toggleHeading({ level: parseInt(e.target.value) })
            .run()
        }
      >
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
        <ToolBtn
          onClick={() => editor.chain().focus().toggleNode('calloutInfo').run()}
        >
          <AlertCircle size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'Warning Callout'}>
        <ToolBtn
          onClick={() =>
            editor.chain().focus().toggleNode('calloutWarning').run()
          }
        >
          <AlertTriangle size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'Image'}>
        <ToolBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockImage',
              })
              .run()
          }
        >
          <ImagePlus size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'Video'}>
        <ToolBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockVideo',
              })
              .run()
          }
        >
          <Video size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'YouTube video'}>
        <ToolBtn  onClick={() => editor.chain().focus().insertContent({ type: 'blockEmbed' }).run()}>
          <SiYoutube size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'Math Equation (LaTeX)'}>
        <ToolBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockMathEquation',
              })
              .run()
          }
        >
          <Sigma size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'PDF Document'}>
        <ToolBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockPDF',
              })
              .run()
          }
        >
          <FileText size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'Interactive Quiz'}>
        <ToolBtn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockQuiz',
              })
              .run()
          }
        >
          <BadgeHelp size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'Code Block'}>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={editor.isActive('codeBlock') ? 'is-active' : ''}
        >
          <Code size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'External Object (Embed)'}>
        <ToolBtn
          onClick={() => editor.chain().focus().insertContent({ type: 'blockEmbed' }).run()}
        >
          <Cuboid size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'Badges'}>
        <ToolBtn
          onClick={() => editor.chain().focus().insertContent({
            type: 'badge',
            content: [
              {
                type: 'text',
                text: 'This is a Badge'
              }
            ]
          }).run()}
        >
          <Tags size={15} />
        </ToolBtn>
      </ToolTip>
      <ToolTip content={'Button'}>
        <ToolBtn
          onClick={() => editor.chain().focus().insertContent({
            type: 'button',
            content: [
              {
                type: 'text',
                text: 'Click me'
              }
            ]
          }).run()}
        >
          <MousePointerClick size={15} />
        </ToolBtn>
      </ToolTip>
    </ToolButtonsWrapper>
  )
}

const ToolButtonsWrapper = styled.div`
  display: flex;
  flex-direction: row;
  align-items: left;
  justify-content: left;
`

const ToolBtn = styled.div`
  display: flex;
  background: rgba(217, 217, 217, 0.24);
  border-radius: 6px;
  min-width: 25px;
  height: 25px;
  padding: 5px;
  margin-right: 5px;
  transition: all 0.2s ease-in-out;

  svg {
    padding: 1px;
  }

  &.is-active {
    background: rgba(176, 176, 176, 0.5);

    &:hover {
      background: rgba(139, 139, 139, 0.5);
      cursor: pointer;
    }
  }

  &:hover {
    background: rgba(217, 217, 217, 0.48);
    cursor: pointer;
  }
`

const ToolSelect = styled.select`
  display: flex;
  background: rgba(217, 217, 217, 0.185);
  border-radius: 6px;
  width: 100px;
  border: none;
  height: 25px;
  padding: 5px;
  font-size: 11px;
  font-family: 'DM Sans';
  margin-right: 5px;
`

const TableMenuWrapper = styled.div`
  position: relative;
  display: inline-block;
`

const TableDropdown = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  background: white;
  border: 1px solid rgba(217, 217, 217, 0.5);
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  min-width: 180px;
  margin-top: 4px;
`

const TableMenuItem = styled.div`
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: rgba(217, 217, 217, 0.24);
  }

  .icon {
    margin-right: 8px;
    display: flex;
    align-items: center;
  }

  .label {
    font-size: 12px;
    font-family: 'DM Sans';
  }
`