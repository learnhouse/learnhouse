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
  CodeSquare,
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
  Headphones,
} from 'lucide-react'
import { SiYoutube } from '@icons-pack/react-simple-icons'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import React from 'react'
import Image from 'next/image'
import LinkInputTooltip from './LinkInputTooltip'
import lrnaiIcon from 'public/lrnai_icon.png'
import { useOrg } from '@components/Contexts/OrgContext'
import { useTranslation } from 'react-i18next'

export const ToolbarButtons = ({ editor, props }: any) => {
  const { t } = useTranslation()
  const [showTableMenu, setShowTableMenu] = React.useState(false)
  const [showListMenu, setShowListMenu] = React.useState(false)
  const [showCodeMenu, setShowCodeMenu] = React.useState(false)
  const [showLinkInput, setShowLinkInput] = React.useState(false)
  const linkButtonRef = React.useRef<HTMLDivElement>(null)

  // Get AI feature from resolved_features
  const orgContext = useOrg() as any
  const rf = orgContext?.config?.config?.resolved_features
  const canUseAI = rf?.ai?.enabled === true

  if (!editor) {
    return null
  }


  const tableOptions = [
    {
      label: t('editor.toolbar.insert_table'),
      icon: <TableIcon />,
      action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
    {
      label: t('editor.toolbar.add_row'),
      icon: <RowsIcon />,
      action: () => editor.chain().focus().addRowAfter().run()
    },
    {
      label: t('editor.toolbar.add_column'),
      icon: <ColumnsIcon />,
      action: () => editor.chain().focus().addColumnAfter().run()
    },
    {
      label: t('editor.toolbar.delete_row'),
      icon: <SectionIcon />,
      action: () => editor.chain().focus().deleteRow().run()
    },
    {
      label: t('editor.toolbar.delete_column'),
      icon: <ContainerIcon />,
      action: () => editor.chain().focus().deleteColumn().run()
    }
  ]

  const listOptions = [
    {
      label: t('editor.toolbar.bullet_list'),
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
      label: t('editor.toolbar.ordered_list'),
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
    <div className="flex flex-row items-center justify-start flex-wrap gap-[7px] max-[1200px]:gap-[5px]">
      <div className="editor-tool-btn" onClick={() => editor.chain().focus().undo().run()} aria-label="Undo last action">
        <ArrowLeftIcon />
      </div>
      <div className="editor-tool-btn" onClick={() => editor.chain().focus().redo().run()} aria-label="Redo last action">
        <ArrowRightIcon />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`editor-tool-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
        aria-label="Toggle bold formatting"
      >
        <FontBoldIcon />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`editor-tool-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
        aria-label="Toggle italic formatting"
      >
        <FontItalicIcon />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`editor-tool-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
        aria-label="Toggle strikethrough formatting"
      >
        <StrikethroughIcon />
      </div>
      <div className="relative inline-block shrink-0">
        <div
          onClick={() => setShowListMenu(!showListMenu)}
          className={`editor-tool-btn ${showListMenu || editor.isActive('bulletList') || editor.isActive('orderedList') ? 'is-active' : ''}`}
          aria-label="Insert list"
        >
          <ListBulletIcon />
          <ChevronDownIcon />
        </div>
        {showListMenu && (
          <div className="editor-menu-dropdown">
            {listOptions.map((option, index) => (
              <div
                key={index}
                onClick={() => {
                  option.action()
                  setShowListMenu(false)
                }}
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
        <option value="0">{t('editor.toolbar.paragraph')}</option>
        <option value="1">{t('editor.toolbar.heading1')}</option>
        <option value="2">{t('editor.toolbar.heading2')}</option>
        <option value="3">{t('editor.toolbar.heading3')}</option>
        <option value="4">{t('editor.toolbar.heading4')}</option>
        <option value="5">{t('editor.toolbar.heading5')}</option>
        <option value="6">{t('editor.toolbar.heading6')}</option>
      </select>
      <div className="relative inline-block shrink-0">
        <div
          onClick={() => setShowTableMenu(!showTableMenu)}
          className={`editor-tool-btn ${showTableMenu ? 'is-active' : ''}`}
          aria-label="Insert table"
        >
          <TableIcon width={18} />
          <ChevronDownIcon  />
        </div>
        {showTableMenu && (
          <div className="editor-menu-dropdown">
            {tableOptions.map((option, index) => (
              <div
                key={index}
                onClick={() => {
                  option.action()
                  setShowTableMenu(false)
                }}
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
      <ToolTip content={t('editor.blocks.info_callout')}>
        <div
          className="editor-tool-btn editor-tool-btn-info"
          onClick={() => editor.chain().focus().toggleNode('calloutInfo').run()}
          aria-label={t('editor.blocks.info_callout')}
        >
          <AlertCircle size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.warning_callout')}>
        <div
          className="editor-tool-btn editor-tool-btn-warning"
          onClick={() =>
            editor.chain().focus().toggleNode('calloutWarning').run()
          }
          aria-label={t('editor.blocks.warning_callout')}
        >
          <AlertTriangle size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.toolbar.link')}>
        <div style={{ position: 'relative' }}>
          <div
            ref={linkButtonRef}
            onClick={handleLinkClick}
            className={`editor-tool-btn editor-tool-btn-link ${editor.isActive('link') ? 'is-active' : ''}`}
            aria-label={t('editor.toolbar.link')}
          >
            <Link2 size={15} />
          </div>
          {showLinkInput && (
            <LinkInputTooltip
              onSave={handleLinkSave}
              onCancel={handleLinkCancel}
              currentUrl={getCurrentLinkUrl()}
            />
          )}
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.image')}>
        <div
          className="editor-tool-btn editor-tool-btn-media"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockImage',
              })
              .run()
          }
          aria-label={t('editor.blocks.image')}
        >
          <ImagePlus size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.video')}>
        <div
          className="editor-tool-btn editor-tool-btn-media"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockVideo',
              })
              .run()
          }
          aria-label={t('editor.blocks.video')}
        >
          <Video size={15} />
        </div>
      </ToolTip>
      <ToolTip content="Audio">
        <div
          className="editor-tool-btn editor-tool-btn-media"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockAudio',
              })
              .run()
          }
          aria-label="Audio"
        >
          <Headphones size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.youtube')}>
        <div className="editor-tool-btn editor-tool-btn-media" onClick={() => editor.chain().focus().insertContent({ type: 'blockEmbed' }).run()} aria-label={t('editor.blocks.youtube')}>
          <SiYoutube size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.math')}>
        <div
          className="editor-tool-btn editor-tool-btn-math"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockMathEquation',
              })
              .run()
          }
          aria-label={t('editor.blocks.math')}
        >
          <Sigma size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.pdf')}>
        <div
          className="editor-tool-btn editor-tool-btn-document"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockPDF',
              })
              .run()
          }
          aria-label={t('editor.blocks.pdf')}
        >
          <FileText size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.quiz')}>
        <div
          className="editor-tool-btn editor-tool-btn-interactive"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'blockQuiz',
              })
              .run()
          }
          aria-label={t('editor.blocks.quiz')}
        >
          <BadgeHelp size={15} />
        </div>
      </ToolTip>
      <div className="relative inline-block shrink-0">
        <div
          onClick={() => setShowCodeMenu(!showCodeMenu)}
          className={`editor-tool-btn editor-tool-btn-code ${showCodeMenu || editor.isActive('codeBlock') || editor.isActive('blockCode') ? 'is-active' : ''}`}
          aria-label={t('editor.toolbar.code_block')}
        >
          <Code size={15} />
          <ChevronDownIcon />
        </div>
        {showCodeMenu && (
          <div className="editor-menu-dropdown">
            <div
              onClick={() => {
                editor.chain().focus().toggleCodeBlock().run()
                setShowCodeMenu(false)
              }}
              className={`editor-menu-item ${editor.isActive('codeBlock') ? 'is-active' : ''}`}
            >
              <span className="icon"><Code size={15} /></span>
              <span className="label">Basic</span>
            </div>
            <div
              onClick={() => {
                editor.chain().focus().insertContent({
                  type: 'blockCode',
                  attrs: {
                    mode: 'advanced',
                    languageId: 71,
                    languageName: 'Python 3',
                    starterCode: '# Write your code here\n',
                    testCases: [],
                  },
                }).run()
                setShowCodeMenu(false)
              }}
              className="editor-menu-item"
            >
              <span className="icon"><CodeSquare size={15} /></span>
              <span className="label">Playground</span>
            </div>
          </div>
        )}
      </div>
      <ToolTip content={t('editor.blocks.embed')}>
        <div
          className="editor-tool-btn editor-tool-btn-embed"
          onClick={() => editor.chain().focus().insertContent({ type: 'blockEmbed' }).run()}
          aria-label={t('editor.blocks.embed')}
        >
          <Cuboid size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.badge')}>
        <div
          className="editor-tool-btn editor-tool-btn-badge"
          onClick={() => editor.chain().focus().insertContent({
            type: 'badge',
            content: [
              {
                type: 'text',
                text: 'Badge'
              }
            ]
          }).run()}
          aria-label={t('editor.blocks.badge')}
        >
          <Tags size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.button')}>
        <div
          className="editor-tool-btn editor-tool-btn-interactive"
          onClick={() => editor.chain().focus().insertContent({
            type: 'button',
            content: [
              {
                type: 'text',
                text: 'Button'
              }
            ]
          }).run()}
          aria-label={t('editor.blocks.button')}
        >
          <MousePointerClick size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.user')}>
        <div
          className="editor-tool-btn editor-tool-btn-user"
          onClick={() => editor.chain().focus().insertContent({ type: 'blockUser' }).run()}
          aria-label={t('editor.blocks.user')}
        >
          <User size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.web_preview')}>
        <div
          className="editor-tool-btn editor-tool-btn-web"
          onClick={() =>
            editor.chain().focus().insertContent({
              type: 'blockWebPreview',
            }).run()
          }
          aria-label={t('editor.blocks.web_preview')}
        >
          <Globe size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.flipcard')}>
        <div
          className="editor-tool-btn editor-tool-btn-interactive"
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
          aria-label={t('editor.blocks.flipcard')}
        >
          <RotateCw size={15} />
        </div>
      </ToolTip>
      <ToolTip content={t('editor.blocks.scenario')}>
        <div
          className="editor-tool-btn editor-tool-btn-interactive"
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
          aria-label={t('editor.blocks.scenario')}
        >
          <GitBranch size={15} />
        </div>
      </ToolTip>
      <ToolTip content={canUseAI ? t('editor.blocks.magic_block') : t('editor.blocks.magic_block_disabled')}>
        {canUseAI ? (
          <div
            className="editor-tool-btn editor-tool-btn-magic"
            onClick={() =>
              editor.chain().focus().insertContent({
                type: 'blockMagic',
              }).run()
            }
            aria-label={t('editor.blocks.magic_block')}
          >
            <Image src={lrnaiIcon} alt="Magic Block" width={15} height={15} />
          </div>
        ) : (
          <div className="editor-tool-btn editor-tool-btn-magic editor-tool-btn-magic-disabled" aria-label={t('editor.blocks.magic_block_disabled')}>
            <Image src={lrnaiIcon} alt="Magic Block" width={15} height={15} />
          </div>
        )}
      </ToolTip>
    </div>
  )
}
