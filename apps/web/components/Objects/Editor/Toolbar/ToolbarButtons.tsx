import { DividerVerticalIcon } from '@radix-ui/react-icons'
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowsClockwise,
  Books,
  BracketsCurly,
  CaretDown,
  CheckCircle,
  Code,
  Columns,
  ColumnsPlusRight,
  Cube,
  CursorClick,
  FileText,
  GitBranch,
  Hash,
  Globe,
  Headphones,
  Image as ImageIcon,
  Info,
  Lightbulb,
  Link,
  ListBullets,
  ListNumbers,
  Minus,
  PuzzlePiece,
  Rows,
  RowsPlusBottom,
  SealQuestion,
  Sigma,
  SquaresFour,
  Table,
  Tag,
  TextB,
  TextItalic,
  TextStrikethrough,
  User,
  UsersThree,
  VideoCamera,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { SiYoutube } from '@icons-pack/react-simple-icons'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import React from 'react'
import Image from 'next/image'
import LinkInputTooltip from './LinkInputTooltip'
import lrnaiIcon from 'public/lrnai_icon.png'
import { useOrg } from '@components/Contexts/OrgContext'
import { useTranslation } from 'react-i18next'
import dynamic from 'next/dynamic'
import { useDynamicLookups } from '../Extensions/Dynamic/useDynamicLookups'
import { useTaggableCommunities } from '@components/Objects/Communities/Tags/communityTags'

const VariablePicker = dynamic(() => import('../Extensions/Dynamic/VariablePicker'), { ssr: false })
const CustomVariablesModal = dynamic(() => import('../Extensions/Dynamic/CustomVariablesModal'), { ssr: false })

type ToolbarMenuItem = {
  key: string
  label: string
  icon: React.ReactNode
  color?: string
  variant?: string
  active?: boolean
  onSelect: () => void
}

type ToolbarMenuProps = {
  id: string
  openMenu: string | null
  setOpenMenu: React.Dispatch<React.SetStateAction<string | null>>
  label: string
  icon: React.ReactNode
  variant?: string
  active?: boolean
  items: ToolbarMenuItem[]
  children?: React.ReactNode
}

// A toolbar button that opens a dropdown of actions. Only one menu is open at a
// time (the parent owns `openMenu`), and clicking outside or pressing Escape closes it.
function ToolbarMenu({ id, openMenu, setOpenMenu, label, icon, variant = '', active, items, children }: ToolbarMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const isOpen = openMenu === id

  React.useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen, setOpenMenu])

  return (
    <div ref={ref} className="relative inline-block shrink-0">
      <ToolTip content={label}>
        <div
          role="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          // Keep the editor selection so inserts land where the cursor was.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpenMenu(isOpen ? null : id)}
          className={`editor-tool-btn ${variant} ${isOpen || active ? 'is-active' : ''}`}
        >
          {icon}
          <CaretDown size={10} />
        </div>
      </ToolTip>
      {isOpen && (
        <div className="editor-menu-dropdown" role="menu">
          {items.map((item) => (
            <div
              key={item.key}
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpenMenu(null)
                item.onSelect()
              }}
              className={`editor-menu-item ${item.active ? 'is-active' : ''}`}
            >
              <span className="icon">
                <span className={`flex ${item.color ?? ''}`}>{item.icon}</span>
              </span>
              <span className="label">{item.label}</span>
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  )
}

type ToolbarButtonProps = Omit<ToolbarMenuItem, 'key'>

function ToolbarButton({ label, icon, variant = '', active, onSelect }: ToolbarButtonProps) {
  return (
    <ToolTip content={label}>
      <div
        role="button"
        aria-label={label}
        onClick={onSelect}
        className={`editor-tool-btn ${variant} ${active ? 'is-active' : ''}`}
      >
        {icon}
      </div>
    </ToolTip>
  )
}

const scenarioStarter = {
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

export const ToolbarButtons = React.memo(({ editor }: any) => {
  const { t } = useTranslation()
  const [openMenu, setOpenMenu] = React.useState<string | null>(null)
  const [showLinkInput, setShowLinkInput] = React.useState(false)
  const [showVariables, setShowVariables] = React.useState(false)
  const [showCustomVariables, setShowCustomVariables] = React.useState(false)
  const lookups = useDynamicLookups()
  const communities = useTaggableCommunities()
  React.useEffect(() => {
    if (editor?.storage?.communityTagSuggestion) editor.storage.communityTagSuggestion.communities = communities
  }, [editor, communities])

  // The {{ autocomplete reads the org's custom variables from here.
  React.useEffect(() => {
    if (editor?.storage?.variableSuggestion) editor.storage.variableSuggestion.custom = lookups.customDefs
  }, [editor, lookups.customDefs])

  const insertVariable = (path: string) => {
    editor.chain().focus().insertDynamicVariable(path).run()
    setShowVariables(false)
    setShowCustomVariables(false)
  }
  const linkButtonRef = React.useRef<HTMLDivElement>(null)

  // Get AI feature from resolved_features
  const orgContext = useOrg() as any
  const rf = orgContext?.config?.config?.resolved_features
  const canUseAI = rf?.ai?.enabled === true

  if (!editor) {
    return null
  }

  const insertBlock = (content: any) => () => editor.chain().focus().insertContent(content).run()

  const listItems: ToolbarMenuItem[] = [
    {
      key: 'bullet',
      label: t('editor.toolbar.bullet_list'),
      icon: <ListBullets size={15} />,
      active: editor.isActive('bulletList'),
      onSelect: () => {
        if (editor.isActive('bulletList')) {
          editor.chain().focus().toggleBulletList().run()
        } else {
          editor.chain().focus().toggleOrderedList().run()
          editor.chain().focus().toggleBulletList().run()
        }
      }
    },
    {
      key: 'ordered',
      label: t('editor.toolbar.ordered_list'),
      icon: <ListNumbers size={15} />,
      active: editor.isActive('orderedList'),
      onSelect: () => {
        if (editor.isActive('orderedList')) {
          editor.chain().focus().toggleOrderedList().run()
        } else {
          editor.chain().focus().toggleBulletList().run()
          editor.chain().focus().toggleOrderedList().run()
        }
      }
    }
  ]

  const tableItems: ToolbarMenuItem[] = [
    {
      key: 'insert',
      label: t('editor.toolbar.insert_table'),
      icon: <Table size={15} />,
      onSelect: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
    {
      key: 'add_row',
      label: t('editor.toolbar.add_row'),
      icon: <RowsPlusBottom size={15} />,
      onSelect: () => editor.chain().focus().addRowAfter().run()
    },
    {
      key: 'add_column',
      label: t('editor.toolbar.add_column'),
      icon: <ColumnsPlusRight size={15} />,
      onSelect: () => editor.chain().focus().addColumnAfter().run()
    },
    {
      key: 'delete_row',
      label: t('editor.toolbar.delete_row'),
      icon: <Rows size={15} />,
      onSelect: () => editor.chain().focus().deleteRow().run()
    },
    {
      key: 'delete_column',
      label: t('editor.toolbar.delete_column'),
      icon: <Columns size={15} />,
      onSelect: () => editor.chain().focus().deleteColumn().run()
    }
  ]

  const calloutItems: ToolbarMenuItem[] = [
    { type: 'info',    label: 'Info',    icon: <Info size={14} weight="fill" />,        color: 'text-gray-500'   },
    { type: 'warning', label: 'Warning', icon: <Warning size={14} weight="fill" />,     color: 'text-yellow-500' },
    { type: 'tip',     label: 'Tip',     icon: <Lightbulb size={14} weight="fill" />,   color: 'text-green-500'  },
    { type: 'success', label: 'Success', icon: <CheckCircle size={14} weight="fill" />, color: 'text-teal-500'   },
    { type: 'error',   label: 'Error',   icon: <XCircle size={14} weight="fill" />,     color: 'text-red-500'    },
  ].map(({ type, ...item }) => ({
    ...item,
    key: type,
    onSelect: insertBlock({ type: 'callout', attrs: { type }, content: [{ type: 'paragraph' }] }),
  }))

  // Shown as their own buttons so the range of blocks stays visible.
  const mediaButtons: ToolbarMenuItem[] = [
    {
      key: 'image',
      label: t('editor.blocks.image'),
      icon: <ImageIcon size={15} weight="fill" />,
      variant: 'editor-tool-btn-media',
      onSelect: insertBlock({ type: 'blockImage' })
    },
    {
      key: 'video',
      label: t('editor.blocks.video'),
      icon: <VideoCamera size={15} weight="fill" />,
      variant: 'editor-tool-btn-media',
      onSelect: insertBlock({ type: 'blockVideo' })
    },
    {
      key: 'audio',
      label: t('editor.blocks.audio'),
      icon: <Headphones size={15} weight="fill" />,
      variant: 'editor-tool-btn-media',
      onSelect: insertBlock({ type: 'blockAudio' })
    },
    {
      key: 'pdf',
      label: t('editor.blocks.pdf'),
      icon: <FileText size={15} weight="fill" />,
      variant: 'editor-tool-btn-document',
      onSelect: insertBlock({ type: 'blockPDF' })
    },
    {
      key: 'library',
      label: t('editor.blocks.library'),
      icon: <Books size={15} weight="fill" />,
      variant: 'editor-tool-btn-document',
      onSelect: insertBlock({ type: 'blockLibrary' })
    }
  ]

  const embedItems: ToolbarMenuItem[] = [
    {
      key: 'embed',
      label: t('editor.blocks.embed'),
      icon: <Cube size={15} weight="fill" />,
      color: 'text-teal-600',
      onSelect: insertBlock({ type: 'blockEmbed' })
    },
    {
      // Same block as Embed, listed so YouTube is easy to find.
      key: 'youtube',
      label: t('editor.blocks.youtube'),
      icon: <SiYoutube size={15} />,
      color: 'text-red-600',
      onSelect: insertBlock({ type: 'blockEmbed' })
    },
    {
      key: 'web_preview',
      label: t('editor.blocks.web_preview'),
      icon: <Globe size={15} weight="fill" />,
      color: 'text-sky-600',
      onSelect: insertBlock({ type: 'blockWebPreview' })
    }
  ]

  const mathButton: ToolbarButtonProps = {
    label: t('editor.blocks.math'),
    icon: <Sigma size={15} weight="fill" />,
    variant: 'editor-tool-btn-math',
    onSelect: insertBlock({ type: 'blockMathEquation' })
  }

  const codeItems: ToolbarMenuItem[] = [
    {
      key: 'code',
      label: t('editor.toolbar.code_block'),
      icon: <Code size={15} weight="fill" />,
      active: editor.isActive('codeBlock'),
      onSelect: () => editor.chain().focus().toggleCodeBlock().run()
    },
    {
      key: 'playground',
      label: t('editor.toolbar.code_playground'),
      icon: <BracketsCurly size={15} weight="fill" />,
      onSelect: insertBlock({
        type: 'blockCode',
        attrs: {
          mode: 'advanced',
          languageId: 71,
          languageName: 'Python 3',
          starterCode: '# Write your code here\n',
          testCases: [],
        },
      })
    }
  ]

  const interactiveButtons: ToolbarMenuItem[] = [
    {
      key: 'quiz',
      label: t('editor.blocks.quiz'),
      icon: <SealQuestion size={15} weight="fill" />,
      variant: 'editor-tool-btn-interactive',
      onSelect: insertBlock({ type: 'blockQuiz' })
    },
    {
      key: 'flipcard',
      label: t('editor.blocks.flipcard'),
      icon: <ArrowsClockwise size={15} weight="fill" />,
      variant: 'editor-tool-btn-interactive',
      onSelect: insertBlock({
        type: 'flipcard',
        attrs: {
          question: 'Click to reveal the answer',
          answer: 'This is the answer',
          color: 'blue',
          alignment: 'center',
          size: 'medium'
        }
      })
    },
    {
      key: 'scenario',
      label: t('editor.blocks.scenario'),
      icon: <GitBranch size={15} weight="fill" />,
      variant: 'editor-tool-btn-interactive',
      onSelect: insertBlock({ type: 'scenarios', attrs: scenarioStarter })
    },
    {
      key: 'h5p',
      label: t('editor.blocks.h5p'),
      icon: <PuzzlePiece size={15} weight="fill" />,
      variant: 'editor-tool-btn-interactive',
      onSelect: insertBlock({ type: 'blockH5P' })
    }
  ]

  const elementItems: ToolbarMenuItem[] = [
    {
      key: 'divider',
      label: t('editor.blocks.divider'),
      icon: <Minus size={15} weight="bold" />,
      color: 'text-slate-600',
      onSelect: () => editor.chain().focus().setHorizontalRule().run()
    },
    {
      key: 'badge',
      label: t('editor.blocks.badge'),
      icon: <Tag size={15} weight="fill" />,
      color: 'text-pink-600',
      onSelect: insertBlock({ type: 'badge', content: [{ type: 'text', text: 'Badge' }] })
    },
    {
      key: 'button',
      label: t('editor.blocks.button'),
      icon: <CursorClick size={15} weight="fill" />,
      color: 'text-green-600',
      onSelect: insertBlock({ type: 'button', content: [{ type: 'text', text: 'Button' }] })
    },
    {
      key: 'user',
      label: t('editor.blocks.user'),
      icon: <User size={15} weight="fill" />,
      color: 'text-indigo-600',
      onSelect: insertBlock({ type: 'blockUser' })
    }
  ]
  const dynamicItems: ToolbarMenuItem[] = [
    {
      key: 'variable',
      label: t('editor.dynamic.toolbar.variable', { example: '{{', defaultValue: 'Insert a variable (or type {{example}})' }),
      icon: <BracketsCurly size={15} weight="bold" />,
      color: 'text-fuchsia-700',
      onSelect: () => setShowVariables(true)
    },
    {
      key: 'conditional',
      label: t('editor.dynamic.toolbar.conditional', 'Content only some learners see'),
      icon: <UsersThree size={15} weight="fill" />,
      color: 'text-fuchsia-700',
      onSelect: () => editor.chain().focus().insertConditionalBlock({ openRules: true }).run()
    },
    {
      key: 'community',
      label: t('editor.dynamic.toolbar.community', { example: '#', defaultValue: 'Link a community (or type {{example}})' }),
      icon: <Hash size={15} weight="bold" />,
      color: 'text-fuchsia-700',
      onSelect: () => editor.chain().focus().insertContent(' #').run()
    }
  ]

  const handleLinkClick = () => {
    // Store the current selection
    const { from, to } = editor.state.selection

    setShowLinkInput(true)

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
        <ArrowCounterClockwise size={15} />
      </div>
      <div className="editor-tool-btn" onClick={() => editor.chain().focus().redo().run()} aria-label="Redo last action">
        <ArrowClockwise size={15} />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`editor-tool-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
        aria-label="Toggle bold formatting"
      >
        <TextB size={15} />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`editor-tool-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
        aria-label="Toggle italic formatting"
      >
        <TextItalic size={15} />
      </div>
      <div
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`editor-tool-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
        aria-label="Toggle strikethrough formatting"
      >
        <TextStrikethrough size={15} />
      </div>
      <ToolTip content={t('editor.toolbar.link')}>
        <div style={{ position: 'relative' }}>
          <div
            ref={linkButtonRef}
            onClick={handleLinkClick}
            className={`editor-tool-btn editor-tool-btn-link ${editor.isActive('link') ? 'is-active' : ''}`}
            aria-label={t('editor.toolbar.link')}
          >
            <Link size={15} />
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
      <ToolbarMenu
        id="list"
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        label={t('editor.toolbar.list')}
        icon={<ListBullets size={15} />}
        active={editor.isActive('bulletList') || editor.isActive('orderedList')}
        items={listItems}
      />
      <ToolbarMenu
        id="table"
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        label={t('editor.toolbar.table')}
        icon={<Table size={15} />}
        items={tableItems}
      />
      <DividerVerticalIcon
        style={{ marginTop: 'auto', marginBottom: 'auto', color: 'grey' }}
      />
      <ToolbarMenu
        id="callout"
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        label={t('editor.blocks.callout')}
        icon={<Info size={15} />}
        variant="editor-tool-btn-info"
        active={editor.isActive('callout') || editor.isActive('calloutInfo') || editor.isActive('calloutWarning')}
        items={calloutItems}
      />
      {mediaButtons.map(({ key, ...item }) => <ToolbarButton key={key} {...item} />)}
      <ToolbarMenu
        id="embed"
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        label={t('editor.blocks.embed')}
        icon={<Cube size={15} weight="fill" />}
        variant="editor-tool-btn-embed"
        items={embedItems}
      />
      <ToolbarButton {...mathButton} />
      <ToolbarMenu
        id="code"
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        label={t('editor.toolbar.code_block')}
        icon={<Code size={15} weight="fill" />}
        variant="editor-tool-btn-code"
        active={editor.isActive('codeBlock') || editor.isActive('blockCode')}
        items={codeItems}
      />
      {interactiveButtons.map(({ key, ...item }) => <ToolbarButton key={key} {...item} />)}
      <ToolbarMenu
        id="elements"
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        label={t('editor.toolbar.elements_menu')}
        icon={<SquaresFour size={15} weight="fill" />}
        variant="editor-tool-btn-badge"
        items={elementItems}
      />
      <DividerVerticalIcon style={{ marginTop: 'auto', marginBottom: 'auto', color: 'grey', opacity: 0.5 }} />
      <ToolbarMenu
        id="dynamic"
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        label={t('editor.dynamic.toolbar.menu_label', 'Personalize')}
        icon={<BracketsCurly size={15} weight="bold" />}
        variant="editor-tool-btn-dynamic"
        active={showVariables}
        items={dynamicItems}
      >
        {showVariables && (
          <VariablePicker
            customDefs={lookups.customDefs}
            onPick={(def) => insertVariable(def.path)}
            onManageCustom={() => {
              setShowVariables(false)
              setShowCustomVariables(true)
            }}
            onClose={() => setShowVariables(false)}
          />
        )}
      </ToolbarMenu>
      {showCustomVariables && (
        <CustomVariablesModal onClose={() => setShowCustomVariables(false)} onInsert={insertVariable} />
      )}
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
})

ToolbarButtons.displayName = 'ToolbarButtons'
