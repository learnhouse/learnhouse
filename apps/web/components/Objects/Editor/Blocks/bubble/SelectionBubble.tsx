'use client'
/*
 Selection menu: appears over selected text in the activity editor.

   Turn into ▾ · B I U S </> · link · Color ▾ · Effects ▾ · Comment · AI ▾ · ⋯

 Same 32px buttons, 16px icons and soft active pill as the toolbar. All
 panels open INSIDE the bubble element (no portals), so focus never leaves
 the menu and Tiptap's BubbleMenu doesn't hide it mid-use. Escape closes a
 panel, then the menu. On phones the row scrolls sideways.

 AI results are never applied silently: they show as a word diff (or a list
 of generated cards/questions) with Accept / Discard.
*/
import React from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import {
  ArrowSquareOut,
  CaretDown,
  ChatCircleText,
  Check,
  Code,
  CodeBlock,
  Copy,
  DotsThree,
  Eraser,
  Info,
  Keyboard,
  Link as LinkIcon,
  LinkBreak,
  ListBullets,
  ListNumbers,
  MagnifyingGlass,
  Paragraph,
  Quotes,
  PaintBrush,
  TextAa,
  TextB,
  TextHOne,
  TextHThree,
  TextHTwo,
  TextItalic,
  TextStrikethrough,
  TextSubscript,
  TextSuperscript,
  TextUnderline,
  EyeSlash,
  BookOpenText,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { AIMark, AIThinking } from '@components/Objects/AI/AIBrand'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import useGetAIFeatures from '@components/Hooks/useGetAIFeatures'
import { startActivityAIChatSession } from '@services/ai/ai'
import { routeSelectionAction } from '../../AI/aiEditorBridge'
import { carryMarks } from '../../AI/engine/carryMarks'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import { HIGHLIGHT_STYLES, TEXT_COLORS, TEXT_EFFECTS, type HighlightStyle, type TextColor, type TextEffect } from '../marks/textMarks'
import {
  AIAction,
  BLOCK_AI_ACTIONS,
  TEXT_AI_ACTIONS,
  TONE_AI_ACTIONS,
  buildAIPrompt,
  cleanAIText,
  countWords,
  flashcardNodesFromAI,
  passageLink,
  quizNodeFromAI,
  textToContent,
  wordDiff,
} from './selectionTools'

const BTN =
  'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-[13px] font-medium text-neutral-600 transition-colors outline-none hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/15'
const ACTIVE = 'bg-neutral-900/[0.07] text-neutral-900'
const ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-[13px] text-neutral-700 transition-colors outline-none hover:bg-neutral-100 focus-visible:bg-neutral-100'
const PANEL =
  'absolute top-full mt-1.5 rounded-xl bg-white p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.08)] max-w-[calc(100vw-16px)]'

const SWATCH: Record<TextColor, string> = {
  gray: '#737373', red: '#dc2626', orange: '#ea580c', amber: '#d97706', green: '#16a34a',
  teal: '#0d9488', blue: '#2563eb', purple: '#7c3aed', pink: '#db2777',
}
const SWATCH_BG: Record<TextColor, string> = {
  gray: '#e5e5e5', red: '#fecaca', orange: '#fed7aa', amber: '#fde68a', green: '#bbf7d0',
  teal: '#99f6e4', blue: '#bfdbfe', purple: '#ddd6fe', pink: '#fbcfe8',
}

type Panel = null | 'turn' | 'link' | 'color' | 'effects' | 'ai' | 'more'

function Btn({ label, active, onClick, children, className, shortcut }: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
  shortcut?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active ?? undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(BTN, active && ACTIVE, className)}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-neutral-200" />
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl+'

export default function SelectionBubble({ editor, activity, course }: { editor: any; activity: any; course?: any }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const aiFeature = useGetAIFeatures({ feature: 'editor' })
  const canUseAI = org?.config?.config?.resolved_features?.ai?.enabled === true && !!aiFeature
  const [panel, setPanel] = React.useState<Panel>(null)
  const [linkDraft, setLinkDraft] = React.useState('')
  const [noteDraft, setNoteDraft] = React.useState('')
  const [hlStyle, setHlStyle] = React.useState<HighlightStyle>('fill')
  const [ai, setAi] = React.useState<null | { action: AIAction; status: 'running' | 'done' | 'error'; from: number; to: number; original: string; result?: string; node?: any; error?: string }>(null)
  const [language, setLanguage] = React.useState('English')
  const rootRef = React.useRef<HTMLDivElement>(null)

  const state = useEditorState({
    editor,
    selector: ({ editor: e }: any) => {
      if (!e) return null
      const { from, to } = e.state.selection
      let level = 0
      for (let l = 1; l <= 3; l++) if (e.isActive('heading', { level: l })) level = l
      return {
        bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
        code: e.isActive('code'), link: e.isActive('link'), sup: e.isActive('superscript'), sub: e.isActive('subscript'),
        kbd: e.isActive('kbd'), spoiler: e.isActive('spoiler'), definition: e.isActive('definition'),
        color: e.getAttributes('textColor').color || null, highlight: e.isActive('highlight') ? e.getAttributes('highlight') : null,
        effect: e.getAttributes('textEffect').effect || null,
        href: e.getAttributes('link').href || '', note: e.getAttributes('definition').note || '',
        level, bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), quote: e.isActive('blockquote'),
        codeBlock: e.isActive('codeBlock'), callout: e.isActive('callout'),
        text: e.state.doc.textBetween(from, to, ' ', ' '),
        hasComments: typeof e.storage?.comment?.onShortcut === 'function',
      }
    },
  })

  // Close panels when the selection moves elsewhere.
  const selKey = state ? `${editor?.state.selection.from}-${editor?.state.selection.to}` : ''
  React.useEffect(() => {
    if (panel !== 'ai') setPanel(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey])

  if (!editor || !state) return null

  const chain = () => editor.chain().focus()
  const close = () => {
    setPanel(null)
    setAi(null)
  }
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p))
  const words = countWords(state.text)

  const runAI = async (action: AIAction) => {
    const { from, to } = editor.state.selection
    const original = editor.state.doc.textBetween(from, to, '\n\n', ' ')
    const token = session?.data?.tokens?.access_token
    if (!original.trim() || !token) return
    // With the Atlas engine, the AI Editor runs it (reviewable in the page).
    if (routeSelectionAction(action, language)) {
      close()
      return
    }
    setPanel('ai')
    setAi({ action, status: 'running', from, to, original })
    try {
      const res = await startActivityAIChatSession(buildAIPrompt(action, original, language), token, activity?.activity_uuid)
      if (!res.success) throw new Error(res.data?.detail || t('editor.blocks_v2.ai.failed', 'The AI could not answer. Try again.'))
      const raw: string = res.data?.message || ''
      if (action === 'quiz' || action === 'flashcards') {
        const node = action === 'quiz' ? quizNodeFromAI(raw) : flashcardNodesFromAI(raw)
        if (!node) throw new Error(t('editor.blocks_v2.ai.unusable', 'The AI answer could not be turned into blocks. Try again.'))
        setAi({ action, status: 'done', from, to, original, node })
      } else {
        setAi({ action, status: 'done', from, to, original, result: cleanAIText(raw) })
      }
    } catch (err: any) {
      setAi({ action, status: 'error', from, to, original, error: err?.message || String(err) })
    }
  }

  const acceptAI = (mode: 'replace' | 'below') => {
    if (!ai || ai.status !== 'done') return
    const { from, to } = ai
    // Apply only where the original text still is; otherwise at the cursor.
    const stillThere = editor.state.doc.textBetween(from, Math.min(to, editor.state.doc.content.size), '\n\n', ' ') === ai.original
    if (ai.node) {
      const $to = editor.state.doc.resolve(stillThere ? to : editor.state.selection.to)
      const after = $to.depth >= 1 ? $to.after(1) : $to.pos
      chain().insertContentAt(after, ai.node).run()
    } else if (ai.result) {
      if (mode === 'replace' && stillThere) {
        // Inside one paragraph: keep comments, spoilers, links... on the words that survive.
        const oneBlock = editor.state.doc.resolve(from).sameParent(editor.state.doc.resolve(to)) && !/\n{2,}/.test(ai.result.trim())
        const inline = oneBlock ? carryMarks(editor.state.doc.slice(from, to).content.toJSON() || [], [{ type: 'text', text: ai.result.trim() }]).nodes : null
        chain().insertContentAt({ from, to }, inline ?? textToContent(ai.result)).run()
      } else {
        const $to = editor.state.doc.resolve(stillThere ? to : editor.state.selection.to)
        const after = $to.depth >= 1 ? $to.after(1) : $to.pos
        const paras = ai.result.split(/\n{2,}/).filter((p) => p.trim()).map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p.trim() }] }))
        chain().insertContentAt(after, paras).run()
      }
    }
    close()
  }

  const applyLink = () => {
    const raw = linkDraft.trim()
    if (!raw) {
      chain().extendMarkRange('link').unsetLink().run()
    } else {
      const href = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
      if (!/^(https?:|mailto:)/i.test(href)) {
        toast.error(t('editor.blocks_v2.errors.url', 'That doesn’t look like a web link.'))
        return
      }
      chain().extendMarkRange('link').setLink({ href, target: '_blank', rel: 'noopener noreferrer' }).run()
    }
    setPanel(null)
  }

  const turnInto = (kind: string) => {
    const c = chain()
    switch (kind) {
      case 'paragraph': c.clearNodes().run(); break
      case 'h1': c.setHeading({ level: 1 }).run(); break
      case 'h2': c.setHeading({ level: 2 }).run(); break
      case 'h3': c.setHeading({ level: 3 }).run(); break
      case 'quote': c.clearNodes().toggleBlockquote().run(); break
      case 'bullet': c.toggleBulletList().run(); break
      case 'ordered': c.toggleOrderedList().run(); break
      case 'code': c.clearNodes().toggleCodeBlock().run(); break
      case 'callout': c.clearNodes().wrapIn('callout', { type: 'info' }).run(); break
    }
    setPanel(null)
  }

  const turnOptions = [
    { id: 'paragraph', label: t('editor.toolbar.paragraph', 'Paragraph'), icon: <Paragraph size={16} />, active: !state.level && !state.bullet && !state.ordered && !state.quote && !state.codeBlock },
    { id: 'h1', label: t('editor.toolbar.heading1', 'Heading 1'), icon: <TextHOne size={16} />, active: state.level === 1 },
    { id: 'h2', label: t('editor.toolbar.heading2', 'Heading 2'), icon: <TextHTwo size={16} />, active: state.level === 2 },
    { id: 'h3', label: t('editor.toolbar.heading3', 'Heading 3'), icon: <TextHThree size={16} />, active: state.level === 3 },
    { id: 'quote', label: t('editor.blocks_v2.quote', 'Quote'), icon: <Quotes size={16} />, active: state.quote },
    { id: 'callout', label: t('editor.blocks.callout', 'Callout'), icon: <Info size={16} />, active: state.callout },
    { id: 'bullet', label: t('editor.toolbar.bullet_list', 'Bullet list'), icon: <ListBullets size={16} />, active: state.bullet },
    { id: 'ordered', label: t('editor.toolbar.ordered_list', 'Numbered list'), icon: <ListNumbers size={16} />, active: state.ordered },
    { id: 'code', label: t('editor.toolbar.code_block', 'Code block'), icon: <CodeBlock size={16} />, active: state.codeBlock },
  ]
  const currentTurn = turnOptions.find((o) => o.active && o.id !== 'paragraph') ?? turnOptions[0]

  const effectLabel = (e: TextEffect) => t(`editor.blocks_v2.effects.${e.replace('-', '_')}`, {
    'gradient-sunset': 'Sunset gradient', 'gradient-ocean': 'Ocean gradient', 'gradient-aurora': 'Aurora gradient',
    glow: 'Glow', wavy: 'Wavy underline', dotted: 'Dotted underline', smallcaps: 'Small caps', large: 'Large', xlarge: 'Extra large',
  }[e])
  const colorLabel = (c: TextColor) => t(`editor.blocks_v2.colors.${c}`, c.charAt(0).toUpperCase() + c.slice(1))
  const aiLabel = (a: AIAction) => t(`editor.blocks_v2.ai.${a}`, {
    improve: 'Improve writing', shorten: 'Make shorter', expand: 'Make longer', grammar: 'Fix spelling & grammar',
    tone_friendly: 'Friendlier', tone_formal: 'More formal', tone_confident: 'More confident', translate: 'Translate',
    explain: 'Explain simply', quiz: 'Turn into a quiz', flashcards: 'Turn into flashcards',
  }[a])

  const learnerUrl = () => {
    const c = String(course?.course_uuid || '').replace(/^course_/, '')
    const a = String(activity?.activity_uuid || '').replace(/^activity_/, '')
    return `${window.location.origin}/course/${c}/activity/${a}`
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="lhSelectionBubble"
      updateDelay={120}
      options={{ placement: 'top', offset: 8, flip: true, shift: { padding: 8 } } as any}
      shouldShow={({ editor: e, state: s, from, to }: any) => {
        if (!e.isEditable || from === to) return false
        if (s.selection instanceof NodeSelection) return false
        if (e.isActive('codeBlock') || e.isActive('blockCode')) return false
        if (!s.doc.textBetween(from, to).trim()) return false
        const inMenu = rootRef.current?.contains(document.activeElement)
        return e.view.hasFocus() || !!inMenu
      }}
      className="z-[var(--z-editor-bubble)]"
    >
      <div
        ref={rootRef}
        data-lh-selection-bubble=""
        role="toolbar"
        aria-label={t('editor.blocks_v2.selection_menu', 'Selection')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            if (panel) setPanel(null)
            else editor.commands.focus()
          }
        }}
        className="relative"
      >
        <div className="flex max-w-[calc(100vw-16px)] items-center gap-0.5 overflow-x-auto rounded-xl bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.08)] scrollbar-hide">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => togglePanel('turn')}
            aria-haspopup="menu"
            aria-expanded={panel === 'turn'}
            className={cn(BTN, 'ps-2', panel === 'turn' && ACTIVE)}
          >
            <span className="max-w-[96px] truncate">{currentTurn.label}</span>
            <CaretDown size={11} className="text-neutral-400" />
          </button>
          <Divider />
          <Btn label={t('editor.toolbar.bold', 'Bold')} shortcut={`${MOD}B`} active={state.bold} onClick={() => chain().toggleBold().run()}><TextB size={16} /></Btn>
          <Btn label={t('editor.toolbar.italic', 'Italic')} shortcut={`${MOD}I`} active={state.italic} onClick={() => chain().toggleItalic().run()}><TextItalic size={16} /></Btn>
          <Btn label={t('editor.blocks_v2.underline', 'Underline')} shortcut={`${MOD}U`} active={state.underline} onClick={() => chain().toggleUnderline().run()}><TextUnderline size={16} /></Btn>
          <Btn label={t('editor.toolbar.strikethrough', 'Strikethrough')} active={state.strike} onClick={() => chain().toggleStrike().run()}><TextStrikethrough size={16} /></Btn>
          <Btn label={t('editor.blocks_v2.inline_code', 'Inline code')} active={state.code} onClick={() => chain().toggleCode().run()}><Code size={16} /></Btn>
          <Btn
            label={t('editor.toolbar.link', 'Link')}
            active={state.link || panel === 'link'}
            onClick={() => {
              setLinkDraft(state.href)
              togglePanel('link')
            }}
          >
            <LinkIcon size={16} className="text-blue-500" />
          </Btn>
          <Divider />
          <Btn label={t('editor.blocks_v2.color', 'Color')} active={!!state.color || !!state.highlight || panel === 'color'} onClick={() => togglePanel('color')}>
            <span className="flex flex-col items-center leading-none">
              <span className="text-[13px] font-semibold" style={{ color: state.color ? SWATCH[state.color as TextColor] : undefined }}>A</span>
              <span className="mt-0.5 h-[3px] w-3.5 rounded-full" style={{ background: state.highlight ? SWATCH_BG[(state.highlight.color as TextColor) || 'amber'] : state.color ? SWATCH[state.color as TextColor] : '#d4d4d4' }} />
            </span>
            <CaretDown size={10} className="text-neutral-400" />
          </Btn>
          <Btn label={t('editor.blocks_v2.effects_menu', 'Effects')} active={!!state.effect || state.spoiler || state.definition || state.kbd || panel === 'effects'} onClick={() => { setNoteDraft(state.note); togglePanel('effects') }}>
            <PaintBrush size={16} className="text-fuchsia-600" />
            <CaretDown size={10} className="text-neutral-400" />
          </Btn>
          {state.hasComments && (
            <>
              <Divider />
              <Btn
                label={t('editor.blocks_v2.comment', 'Comment')}
                shortcut={`${MOD}${isMac ? '⌥' : 'Alt+'}M`}
                onClick={() => {
                  setPanel(null)
                  editor.storage.comment.onShortcut?.()
                }}
                className="px-2"
              >
                <ChatCircleText size={16} className="text-amber-500" />
                <span className="max-sm:hidden">{t('editor.blocks_v2.comment', 'Comment')}</span>
              </Btn>
            </>
          )}
          {canUseAI && (
            <>
              <Divider />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => togglePanel('ai')}
                aria-haspopup="menu"
                aria-expanded={panel === 'ai'}
                className={cn(BTN, 'px-2 text-violet-700 hover:bg-violet-50 hover:text-violet-800', panel === 'ai' && 'bg-violet-50')}
              >
                <AIMark size={16} alt="" />
                <span className="max-sm:hidden">{t('editor.blocks_v2.ai.ask', 'Ask AI')}</span>
              </button>
            </>
          )}
          <Divider />
          <Btn label={t('editor.blocks_v2.more', 'More')} active={panel === 'more'} onClick={() => togglePanel('more')}><DotsThree size={18} weight="bold" /></Btn>
        </div>

        {panel === 'turn' && (
          <div role="menu" className={cn(PANEL, 'start-0 w-[220px]')}>
            {turnOptions.map((o) => (
              <button key={o.id} type="button" role="menuitemradio" aria-checked={o.active} onMouseDown={(e) => e.preventDefault()} onClick={() => turnInto(o.id)} className={cn(ITEM, o.active && 'bg-neutral-100')}>
                <span className="text-neutral-500">{o.icon}</span>
                <span className="flex-1">{o.label}</span>
                {o.active && <Check size={13} className="text-neutral-500" />}
              </button>
            ))}
          </div>
        )}

        {panel === 'link' && (
          <form
            className={cn(PANEL, 'start-0 flex w-[320px] items-center gap-1')}
            onSubmit={(e) => {
              e.preventDefault()
              applyLink()
            }}
          >
            <input
              autoFocus
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              inputMode="url"
              placeholder={t('editor.blocks_v2.paste_link', 'Paste a link…')}
              aria-label={t('editor.toolbar.link', 'Link')}
              className="h-8 min-w-0 flex-1 rounded-lg bg-neutral-100/80 px-2.5 text-[13px] outline-none placeholder:text-neutral-400 focus:bg-neutral-100"
            />
            <button type="submit" aria-label={t('editor.blocks.common.apply', 'Apply')} className={BTN}><Check size={15} weight="bold" /></button>
            {state.href && (
              <>
                <a href={state.href} target="_blank" rel="noopener noreferrer" aria-label={t('editor.blocks_v2.open_link', 'Open link')} title={t('editor.blocks_v2.open_link', 'Open link')} className={BTN}><ArrowSquareOut size={15} /></a>
                <button type="button" aria-label={t('editor.blocks_v2.unlink', 'Remove link')} title={t('editor.blocks_v2.unlink', 'Remove link')} onClick={() => { chain().extendMarkRange('link').unsetLink().run(); setPanel(null) }} className={BTN}><LinkBreak size={15} /></button>
              </>
            )}
          </form>
        )}

        {panel === 'color' && (
          <div className={cn(PANEL, 'start-0 w-[260px] p-2.5')}>
            <div className="mb-1.5 text-[11px] font-medium text-neutral-400">{t('editor.blocks_v2.text_color', 'Text color')}</div>
            <div className="flex flex-wrap gap-1">
              <button type="button" aria-label={t('editor.blocks_v2.default_color', 'Default')} title={t('editor.blocks_v2.default_color', 'Default')} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().unsetTextColor().run()} className={cn('flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-semibold ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50', !state.color && 'ring-2 ring-neutral-900')}>A</button>
              {TEXT_COLORS.map((c) => (
                <button key={c} type="button" aria-label={colorLabel(c)} title={colorLabel(c)} aria-pressed={state.color === c} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().setTextColor(c).run()} className={cn('flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-semibold ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50', state.color === c && 'ring-2 ring-neutral-900')} style={{ color: SWATCH[c] }}>A</button>
              ))}
            </div>
            <div className="mb-1.5 mt-3 flex items-center justify-between">
              <span className="text-[11px] font-medium text-neutral-400">{t('editor.blocks_v2.highlight', 'Highlight')}</span>
              <div className="flex rounded-md bg-neutral-100 p-0.5" role="radiogroup" aria-label={t('editor.blocks_v2.highlight_style', 'Highlight style')}>
                {HIGHLIGHT_STYLES.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={hlStyle === s} onMouseDown={(e) => e.preventDefault()} onClick={() => setHlStyle(s)} className={cn('h-6 rounded px-1.5 text-[11px] font-medium', hlStyle === s ? 'bg-white text-neutral-900 shadow-[0_0_0_1px_var(--lhb-border,rgba(0,0,0,0.06))]' : 'text-neutral-500')}>
                    {t(`editor.blocks_v2.highlight_styles.${s}`, { fill: 'Fill', marker: 'Marker', underline: 'Underline' }[s])}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <button type="button" aria-label={t('editor.blocks_v2.no_highlight', 'No highlight')} title={t('editor.blocks_v2.no_highlight', 'No highlight')} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().unsetHighlight().run()} className={cn('flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50', !state.highlight && 'ring-2 ring-neutral-900')}><Eraser size={13} className="text-neutral-400" /></button>
              {TEXT_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`${t('editor.blocks_v2.highlight', 'Highlight')}: ${colorLabel(c)}`} title={colorLabel(c)} aria-pressed={state.highlight?.color === c} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().setHighlight({ color: c, style: hlStyle }).run()} className={cn('h-7 w-7 rounded-md ring-1 ring-inset ring-black/5', state.highlight?.color === c && 'ring-2 ring-neutral-900')} style={{ background: SWATCH_BG[c] }} />
              ))}
            </div>
          </div>
        )}

        {panel === 'effects' && (
          <div className={cn(PANEL, 'start-0 w-[300px] p-2')}>
            <div className="grid grid-cols-3 gap-1">
              {TEXT_EFFECTS.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={state.effect === e}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => (state.effect === e ? chain().unsetTextEffect().run() : chain().setTextEffect(e).run())}
                  className={cn('ProseMirror flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-center ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50', state.effect === e && 'ring-2 ring-neutral-900')}
                >
                  <span className={cn('lh-fx text-[14px] font-semibold leading-none', `lh-fx-${e}`, e === 'xlarge' && '!text-[17px]', e === 'large' && '!text-[15px]')}>Aa</span>
                  <span className="truncate text-[10px] text-neutral-500">{effectLabel(e)}</span>
                </button>
              ))}
            </div>
            <div className="my-2 h-px bg-neutral-100" />
            <button type="button" aria-pressed={state.spoiler} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleSpoiler().run()} className={cn(ITEM, state.spoiler && 'bg-neutral-100')}>
              <EyeSlash size={16} className="text-neutral-500" />
              <span className="flex-1">
                <span className="block font-medium text-neutral-800">{t('editor.blocks_v2.spoiler', 'Spoiler')}</span>
                <span className="block text-[11px] text-neutral-400">{t('editor.blocks_v2.spoiler_hint', 'Blurred until learners click it')}</span>
              </span>
              {state.spoiler && <Check size={13} />}
            </button>
            <button type="button" aria-pressed={state.kbd} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleKbd().run()} className={cn(ITEM, state.kbd && 'bg-neutral-100')}>
              <Keyboard size={16} className="text-neutral-500" />
              <span className="flex-1 font-medium text-neutral-800">{t('editor.blocks_v2.kbd', 'Keyboard key')}</span>
              {state.kbd && <Check size={13} />}
            </button>
            <div className="mt-1 rounded-lg p-2 ring-1 ring-inset ring-neutral-200">
              <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-neutral-700">
                <BookOpenText size={15} className="text-neutral-500" />
                {t('editor.blocks_v2.definition', 'Definition')}
                <span className="text-[11px] font-normal text-neutral-400">{t('editor.blocks_v2.definition_hint', 'shown on hover or tap')}</span>
              </div>
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (noteDraft.trim()) chain().setDefinition(noteDraft.trim()).run()
                  else chain().unsetDefinition().run()
                  setPanel(null)
                }}
              >
                <input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  maxLength={500}
                  placeholder={t('editor.blocks_v2.definition_placeholder', 'What does this term mean?')}
                  aria-label={t('editor.blocks_v2.definition', 'Definition')}
                  className="h-8 min-w-0 flex-1 rounded-lg bg-neutral-100/80 px-2.5 text-[13px] outline-none placeholder:text-neutral-400 focus:bg-neutral-100"
                />
                <button type="submit" className={buttonClass('secondary', 'sm')}>{t('editor.blocks.common.apply', 'Apply')}</button>
              </form>
            </div>
          </div>
        )}

        {panel === 'ai' && canUseAI && (
          <div className={cn(PANEL, 'start-0 w-[min(400px,calc(100vw-16px))] p-1.5')} aria-live="polite">
            {!ai && (
              <div role="menu">
                {TEXT_AI_ACTIONS.map((a) => (
                  <button key={a} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runAI(a)} className={ITEM}>
                    <AIMark size={14} alt="" />
                    <span className="flex-1">{aiLabel(a)}</span>
                  </button>
                ))}
                <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-neutral-400">{t('editor.blocks_v2.ai.tone', 'Change tone')}</div>
                <div className="flex flex-wrap gap-1 px-1.5 pb-1">
                  {TONE_AI_ACTIONS.map((a) => (
                    <button key={a} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runAI(a)} className={buttonClass('secondary', 'sm')}>{aiLabel(a)}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 px-1.5 py-1">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    aria-label={t('editor.blocks_v2.ai.language', 'Language')}
                    className="h-7 min-w-0 flex-1 rounded-lg bg-neutral-100/80 px-2 text-[12px] outline-none"
                  >
                    {['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Dutch', 'Arabic', 'Hindi', 'Japanese', 'Korean', 'Chinese', 'Russian', 'Turkish', 'Polish', 'Vietnamese', 'Indonesian', 'Persian'].map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runAI('translate')} className={buttonClass('secondary', 'sm')}>{aiLabel('translate')}</button>
                </div>
                <div className="my-1 h-px bg-neutral-100" />
                {BLOCK_AI_ACTIONS.map((a) => (
                  <button key={a} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runAI(a)} className={ITEM}>
                    <AIMark size={14} alt="" />
                    <span className="flex-1">{aiLabel(a)}</span>
                  </button>
                ))}
              </div>
            )}
            {ai?.status === 'running' && (
              <div className="flex items-center gap-2 px-2 py-3 text-[13px] text-neutral-600">
                <AIThinking />
                <span>{aiLabel(ai.action)}…</span>
              </div>
            )}
            {ai?.status === 'error' && (
              <div className="px-2 py-2">
                <p role="alert" className="text-[13px] text-rose-700">{ai.error}</p>
                <div className="mt-2 flex justify-end gap-1.5">
                  <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setAi(null)}>{t('editor.blocks.common.cancel', 'Cancel')}</button>
                  <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => runAI(ai.action)}>{t('editor.blocks_v2.retry', 'Retry')}</button>
                </div>
              </div>
            )}
            {ai?.status === 'done' && (
              <div className="px-1.5 py-1">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-violet-700/80">
                  <AIMark size={13} alt="" /> {aiLabel(ai.action)}
                </div>
                <div className="max-h-[240px] overflow-y-auto rounded-lg bg-neutral-50 p-2.5 text-[13px] leading-relaxed text-neutral-800 ring-1 ring-inset ring-black/[0.05]" data-ai-preview="">
                  {ai.result != null && (ai.action === 'explain' || ai.action === 'translate'
                    ? <span className="whitespace-pre-line">{ai.result}</span>
                    : wordDiff(ai.original, ai.result).map((p, i) => (
                      <span
                        key={i}
                        className={cn(
                          'whitespace-pre-line',
                          p.kind === 'add' && 'rounded-sm bg-emerald-100 text-emerald-900',
                          p.kind === 'del' && 'rounded-sm bg-rose-50 text-rose-700/80 line-through',
                        )}
                      >
                        {p.text}
                      </span>
                    )))}
                  {ai.node && (
                    <ul className="flex flex-col gap-1.5">
                      {(ai.node.type === 'blockQuiz' ? ai.node.attrs.questions.map((q: any) => ({ a: q.question, b: q.answers.filter((x: any) => x.correct).map((x: any) => x.answer).join(', ') }))
                        : (ai.node.type === 'flipcardGrid' ? ai.node.content : [ai.node]).map((c: any) => ({ a: c.attrs.question, b: c.attrs.answer }))
                      ).map((row: any, i: number) => (
                        <li key={i} className="rounded-md bg-white p-2 ring-1 ring-inset ring-black/[0.05]">
                          <div className="font-medium">{row.a}</div>
                          <div className="text-[12px] text-emerald-700">{row.b}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
                  <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setAi(null)}>{t('editor.blocks_v2.ai.discard', 'Discard')}</button>
                  {ai.result != null && ai.action !== 'explain' && (
                    <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => acceptAI('below')}>{t('editor.blocks_v2.ai.insert_below', 'Insert below')}</button>
                  )}
                  <button type="button" className={buttonClass('primary', 'sm')} onClick={() => acceptAI(ai.action === 'explain' || ai.node ? 'below' : 'replace')}>
                    {ai.action === 'explain' || ai.node ? t('editor.blocks_v2.ai.insert_below', 'Insert below') : t('editor.blocks_v2.ai.accept', 'Accept')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {panel === 'more' && (
          <div role="menu" className={cn(PANEL, 'end-0 w-[240px]')}>
            <div className="px-2 pb-1.5 pt-1 text-[11px] tabular-nums text-neutral-400">
              {t('editor.blocks_v2.word_count', '{{count}} words · {{chars}} characters', { count: words.words, chars: words.chars })}
            </div>
            <button type="button" role="menuitem" aria-pressed={state.sup} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleSuperscript().run()} className={cn(ITEM, state.sup && 'bg-neutral-100')}><TextSuperscript size={16} className="text-neutral-500" /><span className="flex-1">{t('editor.blocks_v2.superscript', 'Superscript')}</span><kbd className="text-[10px] text-neutral-400">{MOD}.</kbd></button>
            <button type="button" role="menuitem" aria-pressed={state.sub} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleSubscript().run()} className={cn(ITEM, state.sub && 'bg-neutral-100')}><TextSubscript size={16} className="text-neutral-500" /><span className="flex-1">{t('editor.blocks_v2.subscript', 'Subscript')}</span><kbd className="text-[10px] text-neutral-400">{MOD},</kbd></button>
            <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { chain().unsetAllMarks().run(); setPanel(null) }} className={ITEM}><TextAa size={16} className="text-neutral-500" /><span className="flex-1">{t('editor.blocks_v2.clear_formatting', 'Clear formatting')}</span></button>
            <div className="my-1 h-px bg-neutral-100" />
            <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { navigator.clipboard?.writeText(state.text).then(() => toast.success(t('editor.blocks_v2.copied', 'Copied'))).catch(() => {}); setPanel(null) }} className={ITEM}><Copy size={16} className="text-neutral-500" /><span className="flex-1">{t('editor.blocks_v2.copy_text', 'Copy text')}</span></button>
            <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { navigator.clipboard?.writeText(passageLink(learnerUrl(), state.text)).then(() => toast.success(t('editor.blocks_v2.link_copied', 'Link to this passage copied'))).catch(() => {}); setPanel(null) }} className={ITEM}><LinkIcon size={16} className="text-neutral-500" /><span className="flex-1">{t('editor.blocks_v2.copy_passage_link', 'Copy link to this passage')}</span></button>
            <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { window.open(`/search?q=${encodeURIComponent(state.text.trim().slice(0, 120))}`, '_blank', 'noopener,noreferrer'); setPanel(null) }} className={ITEM}><MagnifyingGlass size={16} className="text-neutral-500" /><span className="flex-1">{t('editor.blocks_v2.search_selection', 'Search the library for this')}</span></button>
          </div>
        )}
      </div>
    </BubbleMenu>
  )
}
