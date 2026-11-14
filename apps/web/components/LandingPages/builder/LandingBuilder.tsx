'use client'
/**
 * The landing page builder: library and layers on the start side, the live
 * canvas in the middle, the inspector on the end side. Edits autosave to the
 * draft (with a revision check, so two tabs never overwrite each other);
 * publishing shows what changed first.
 */
import React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowArcLeft, ArrowArcRight, ArrowLeft, CaretDown, Check, CircleNotch, ClockCounterClockwise, CloudSlash, Desktop, DeviceMobile,
  DeviceTablet, Eye, FilePlus, House, Layout, ListDashes, Plus, Rocket, SlidersHorizontal, Tray, Warning, X, FileText,
} from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'
import { AIButton } from '@components/Objects/AI/AIBrand'
import LandingAskAtlas from '@ee/components/Atlas/LandingAskAtlas'
import { getUriWithOrg } from '@services/config/config'
import {
  LandingApiError, applyLandingTemplate, createLandingPage, generateLandingWithAI, getLandingPage, getLandingSite,
  getLandingTemplates, landingQueryKeys, publishLandingPage, resolveLandingReview, restoreLandingVersion,
  saveLandingDraft, saveLandingVariant, getLandingVersion, saveLandingSection, type LandingPageDetail,
} from '@services/landing/landing'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import type { Breakpoint, LandingDoc, LandingNode } from '../model/types'
import { asDoc, emptyDoc, INLINE_TEXT } from '../model/types'
import {
  asSection, canContain, detachSymbol, duplicateNode, findNode, insertNode, locate, makeSymbol, moveNode, newId, pruneSymbols, reid,
  removeNode, setProps,
} from '../model/tree'
import { diffDocs } from '../model/diff'
import { useBuilderStore } from './store'
import Canvas, { type DragPayload } from './Canvas'
import LeftPanel from './LeftPanel'
import Inspector from './Inspector'
import { AIDialog, ConflictDialog, DiffList, HistoryDialog, NewPageDialog, PublishDialog, SubmissionsDialog, TemplatePicker } from './dialogs'

const CLIPBOARD_KEY = 'lh-landing-clipboard'

// Elements added straight onto the page use the library section of this kind.
const RECIPE_FOR: Record<string, string> = {
  navbar: 'navbar', footer: 'footer', newsletter: 'newsletter', form: 'contact', courses: 'courses', course: 'featured_course',
  paths: 'paths', communities: 'communities', podcasts: 'podcasts', live_sessions: 'live_sessions', instructors: 'instructors',
  testimonials: 'testimonials', pricing: 'pricing', faq: 'faq', stats: 'stats', logos: 'logos', steps: 'steps', features: 'features',
  countdown: 'countdown', video: 'video', gallery: 'gallery',
}

/** The top-level navbar or footer section holding `id`, or -1. */
function chromeIndex(doc: LandingDoc, id: string | null): number {
  if (!id) return -1
  return doc.root.findIndex((s) => (firstOfType(s, 'navbar') || firstOfType(s, 'footer')) && !!findIn(s, id))
}

function findIn(node: LandingNode, id: string): boolean {
  return node.id === id || (node.children || []).some((c) => findIn(c, id))
}

function firstOfType(node: LandingNode, type: string): LandingNode | null {
  if (node.type === type) return node
  for (const c of node.children || []) {
    const hit = firstOfType(c, type)
    if (hit) return hit
  }
  return null
}
type SaveState = 'saved' | 'saving' | 'dirty' | 'error' | 'offline'

function readClipboard(): LandingNode | null {
  try {
    const raw = localStorage.getItem(CLIPBOARD_KEY)
    return raw ? (JSON.parse(raw) as LandingNode) : null
  } catch {
    return null
  }
}

function IconBtn({ label, onClick, disabled, active, children, testid }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode; testid?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={`inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg transition-colors disabled:opacity-35 ${active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'}`}
    >
      {children}
    </button>
  )
}

function Editor({ page, site, onReload }: { page: LandingPageDetail; site: NonNullable<ReturnType<typeof useSite>['data']>; onReload: (detail?: LandingPageDetail) => void }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const router = useRouter()
  const queryClient = useQueryClient()
  const [state, dispatch] = useBuilderStore(asDoc(page.draft))
  const { doc, selectedId, breakpoint } = state
  const revision = React.useRef(page.draft_revision)
  const savedVersion = React.useRef(0)
  const [saveState, setSaveState] = React.useState<SaveState>('saved')
  const [conflict, setConflict] = React.useState(false)
  const [leftTab, setLeftTab] = React.useState<'add' | 'layers'>('add')
  const [mobilePanel, setMobilePanel] = React.useState<'left' | 'right' | null>(null)
  const [dialog, setDialog] = React.useState<null | 'templates' | 'publish' | 'history' | 'ai' | 'newpage' | 'submissions' | 'review' | 'save-section'>(page.draft?.root?.length ? null : 'templates')
  const [reviewBase, setReviewBase] = React.useState<LandingDoc | null>(null)
  const [pagesOpen, setPagesOpen] = React.useState(false)
  const { data: library } = useQuery({ queryKey: landingQueryKeys.templates(), queryFn: () => getLandingTemplates(token), staleTime: 10 * 60_000, enabled: !!token })

  const commit = React.useCallback((next: LandingDoc, key?: string, select?: string | null) => dispatch({ type: 'commit', doc: next, key, select }), [dispatch])
  const selected = selectedId ? findNode(doc, selectedId) : null
  const isHome = page.slug === ''

  /* ── autosave ───────────────────────────────────────────────────────── */

  const save = React.useCallback(async (force = false) => {
    if (!force && state.version === savedVersion.current) return
    const version = state.version
    setSaveState('saving')
    try {
      const res = await saveLandingDraft(page.page_uuid, doc, force ? null : revision.current, token)
      revision.current = res.draft_revision
      savedVersion.current = version
      setSaveState('saved')
    } catch (e: any) {
      if (e instanceof LandingApiError && e.status === 409) {
        setSaveState('error')
        setConflict(true)
      } else if (e instanceof LandingApiError && e.status === 422) {
        setSaveState('error')
        const first = e.detail?.errors?.[0]
        toast.error(first ? `${t('landingBuilder.save.invalid')}: ${first.message}` : t('landingBuilder.save.invalid'))
      } else {
        setSaveState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error')
      }
    }
  }, [state.version, doc, page.page_uuid, token, t])

  React.useEffect(() => {
    if (state.version === savedVersion.current) return
    setSaveState('dirty')
    const timer = setTimeout(() => save(), 1200)
    return () => clearTimeout(timer)
  }, [state.version, save])

  // Retry a failed save every few seconds (not after a conflict: a person decides).
  React.useEffect(() => {
    if ((saveState !== 'error' && saveState !== 'offline') || conflict) return
    const timer = setTimeout(() => save(), 5000)
    return () => clearTimeout(timer)
  }, [saveState, conflict, save])

  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state.version !== savedVersion.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state.version])

  /** Load a fresh copy from the server (restore, template, AI, conversion, conflict). */
  const loadDetail = React.useCallback((detail: LandingPageDetail) => {
    revision.current = detail.draft_revision
    dispatch({ type: 'reset', doc: asDoc(detail.draft), keepHistory: true })
    savedVersion.current = state.version + 1
    setSaveState('saved')
    onReload(detail)
  }, [dispatch, onReload, state.version])

  /* ── edits ──────────────────────────────────────────────────────────── */

  const insert = React.useCallback((node: LandingNode, parentId?: string | null, index?: number) => {
    let target: { parentId: string | null; index?: number } = { parentId: parentId ?? null, index }
    if (parentId === undefined) {
      // Click to add: after the selection, or inside it when it is a container.
      const sel = selectedId ? findNode(doc, selectedId) : null
      const loc = selectedId ? locate(doc, selectedId) : null
      if (node.type === 'section' || node.type === 'symbol') {
        const top = selectedId ? doc.root.findIndex((n) => n.id === selectedId || JSON.stringify(n).includes(`"id":"${selectedId}"`)) : -1
        target = { parentId: null, index: top >= 0 ? top + 1 : undefined }
      } else if (node.type === 'navbar' || node.type === 'footer') {
        // Site chrome is never nested in a content section.
        target = { parentId: null }
      } else if (chromeIndex(doc, selectedId) >= 0) {
        // The selection is the navbar or footer: content goes on the page
        // next to it (below the navbar, above the footer), never inside it.
        const i = chromeIndex(doc, selectedId)
        target = { parentId: null, index: firstOfType(doc.root[i], 'footer') ? i : i + 1 }
      } else if (sel && canContain(sel, node)) {
        // Into a section: its content container (the first one), so the new
        // element gets the section's width and padding.
        const inner = sel.type === 'section' ? sel.children?.find((c) => c.type === 'container') ?? sel : sel
        target = { parentId: inner.id }
      } else if (loc && loc.parentId) {
        target = { parentId: loc.parentId, index: loc.index + 1 }
      } else {
        target = { parentId: null }
      }
    }
    const parent = target.parentId ? findNode(doc, target.parentId) : null
    let placed = node
    let selectId = node.id
    let finalParent = target.parentId
    if (parent?.type === 'section' && canContain(parent, node) && node.type !== 'container' && node.type !== 'columns') {
      // A section without a content container: add one around the element.
      placed = { ...asSection(node).children![0], id: newId() }
    }
    if (!canContain(parent, node) || (finalParent === null && (node.type === 'navbar' || node.type === 'footer'))) {
      // A loose element on the page: use its ready-made section when there
      // is one (styled, padded, centered), else a plain section around it.
      const recipe = RECIPE_FOR[node.type] && library?.sections.find((s) => s.kind === RECIPE_FOR[node.type])
      placed = recipe ? reid(recipe.node) : asSection(node)
      if (recipe) selectId = firstOfType(placed, node.type)?.id ?? placed.id
      finalParent = null
    }
    // Clicked (not dropped): a navbar goes to the top, a footer to the bottom.
    let at = target.index
    if (parentId === undefined && finalParent === null) {
      if (firstOfType(placed, 'navbar')) at = 0
      else if (firstOfType(placed, 'footer')) at = doc.root.length
    }
    commit(insertNode(doc, placed, finalParent, at), undefined, selectId)
    setMobilePanel(null)
  }, [doc, selectedId, commit, library])

  /** A saved section: fresh ids, plus the reusable components it uses. */
  const insertSaved = React.useCallback((node: LandingNode, symbols: Record<string, { name: string; node: LandingNode }>) => {
    const placed = reid(node)
    const top = selectedId ? doc.root.findIndex((n) => n.id === selectedId || JSON.stringify(n).includes(`"id":"${selectedId}"`)) : -1
    const merged = { ...doc, symbols: { ...(symbols || {}), ...doc.symbols } }
    commit(insertNode(merged, placed, null, top >= 0 ? top + 1 : undefined), undefined, placed.id)
    setMobilePanel(null)
  }, [doc, selectedId, commit])

  /** The top-level section holding the selection (what "Save section" saves). */
  const selectedSection = React.useMemo(() => {
    if (!selectedId) return null
    return doc.root.find((n) => n.id === selectedId || JSON.stringify(n).includes(`"id":"${selectedId}"`)) || null
  }, [doc, selectedId])

  const onDrop = (payload: DragPayload, parentId: string | null, index: number) => {
    if (payload.kind === 'new') insert(payload.node, parentId, index)
    else {
      const node = findNode(doc, payload.id)
      const parent = parentId ? findNode(doc, parentId) : null
      if (!node || !canContain(parent, node)) return
      commit(moveNode(doc, payload.id, parentId, index), undefined, payload.id)
    }
  }

  const action = React.useCallback((kind: 'duplicate' | 'delete' | 'up' | 'down' | 'parent' | 'symbol' | 'detach' | 'save') => {
    if (!selectedId) return
    if (kind === 'save') {
      setDialog('save-section')
      return
    }
    const loc = locate(doc, selectedId)
    if (kind === 'parent') {
      if (loc?.parentId) dispatch({ type: 'select', id: loc.parentId })
      return
    }
    if (kind === 'duplicate') {
      const res = duplicateNode(doc, selectedId)
      if (res.id) commit(res.doc, undefined, res.id)
    } else if (kind === 'delete') {
      if (loc?.symbolId && loc.parentId === null) return
      commit(pruneSymbols(removeNode(doc, selectedId)), undefined, loc?.parentId ?? null)
    } else if (kind === 'up' || kind === 'down') {
      if (!loc) return
      const to = kind === 'up' ? loc.index - 1 : loc.index + 2
      if (to < 0) return
      commit(moveNode(doc, selectedId, loc.parentId, to))
    } else if (kind === 'symbol') {
      const node = findNode(doc, selectedId)
      const res = makeSymbol(doc, selectedId, node?.name || t(`landingBuilder.elements.${node?.type || 'container'}`))
      if (res.symbolId) {
        commit(res.doc)
        toast.success(t('landingBuilder.settings.symbol_made'))
      }
    } else if (kind === 'detach') {
      commit(pruneSymbols(detachSymbol(doc, selectedId)), undefined, null)
    }
  }, [doc, selectedId, commit, dispatch, t])

  const onTextCommit = React.useCallback((id: string, field: string, value: string) => {
    const node = findNode(doc, id)
    dispatch({ type: 'edit', id: null })
    if (!node || node.props?.[field] === value) return
    commit(setProps(doc, id, { [field]: value }), `inline:${id}`)
  }, [doc, commit, dispatch])

  /* ── keyboard ───────────────────────────────────────────────────────── */

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.closest?.('input, textarea, select, [contenteditable=true]')) return
      if (document.querySelector('[role=dialog]')) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (mod && k === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if (mod && k === 's') {
        e.preventDefault()
        save(false)
      } else if (mod && k === 'd' && selectedId) {
        e.preventDefault()
        action('duplicate')
      } else if (mod && k === 'c' && selectedId) {
        const node = findNode(doc, selectedId)
        if (node) {
          try {
            localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(node))
          } catch {
            /* storage full or blocked */
          }
          toast.success(t('landingBuilder.toasts.copied'))
        }
      } else if (mod && k === 'v') {
        const node = readClipboard()
        if (node) {
          e.preventDefault()
          insert(reid(node))
        }
      } else if ((k === 'delete' || k === 'backspace') && selectedId) {
        e.preventDefault()
        action('delete')
      } else if (k === 'escape') {
        if (selectedId) {
          const loc = locate(doc, selectedId)
          dispatch({ type: 'select', id: loc?.parentId ?? null })
        }
      } else if (k === 'enter' && selectedId) {
        const node = findNode(doc, selectedId)
        if (node && INLINE_TEXT[node.type]) {
          e.preventDefault()
          dispatch({ type: 'edit', id: selectedId })
        }
      } else if ((k === 'arrowup' || k === 'arrowdown') && e.altKey && selectedId) {
        e.preventDefault()
        action(k === 'arrowup' ? 'up' : 'down')
      } else if (!mod && !e.altKey && ['1', '2', '3'].includes(k)) {
        dispatch({ type: 'breakpoint', value: (['base', 'tablet', 'mobile'] as Breakpoint[])[Number(k) - 1] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, selectedId, action, insert, dispatch, save, t])

  /* ── server actions ─────────────────────────────────────────────────── */

  const flush = async () => {
    if (state.version !== savedVersion.current) await save()
  }

  const publish = async ({ label }: { label: string }) => {
    await flush()
    try {
      const detail = await publishLandingPage(page.page_uuid, { label, base_revision: revision.current }, token)
      revision.current = detail.draft_revision
      onReload(detail)
      queryClient.invalidateQueries({ queryKey: landingQueryKeys.site(org.id) })
      queryClient.invalidateQueries({ queryKey: ['landing', 'public'] })
      toast.success(t('landingBuilder.toasts.published'))
    } catch (e: any) {
      if (e?.status === 409) setConflict(true)
      else toast.error(e?.message || t('landingBuilder.toasts.publish_failed'))
      throw e
    }
  }

  const openPreview = async () => {
    await flush()
    const path = isHome ? '/' : `/p/${page.slug}`
    window.open(`${getUriWithOrg(org.slug, path)}?landing_preview=${encodeURIComponent(page.preview_token)}`, '_blank', 'noopener')
  }

  const openReview = async () => {
    const base = page.review?.base_version_uuid
    if (!base) return
    try {
      const v = await getLandingVersion(base, token)
      setReviewBase(asDoc(v.doc))
      setDialog('review')
    } catch {
      toast.error(t('landingBuilder.toasts.load_failed'))
    }
  }

  // Atlas, an API token or another tab may change the draft while it is
  // open: pick that up when there is nothing unsaved here.
  const { data: remote } = useQuery({
    queryKey: ['landing', 'page-poll', page.page_uuid],
    queryFn: () => getLandingPage(page.page_uuid, token),
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    enabled: !!token,
  })
  React.useEffect(() => {
    if (!remote || remote.draft_revision <= revision.current) return
    if (state.version !== savedVersion.current || state.editingId) return
    loadDetail(remote)
    toast(remote.review ? t('landingBuilder.review.arrived') : t('landingBuilder.toasts.updated_elsewhere'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote])

  const reviewDiff = React.useMemo(() => (reviewBase ? diffDocs(reviewBase, doc) : null), [reviewBase, doc])

  /* ── render ─────────────────────────────────────────────────────────── */

  const saveLabel = {
    saved: t('landingBuilder.save.saved'),
    saving: t('landingBuilder.save.saving'),
    dirty: t('landingBuilder.save.dirty'),
    error: t('landingBuilder.save.error'),
    offline: t('landingBuilder.save.offline'),
  }[saveState]
  const SaveIcon = saveState === 'saving' ? CircleNotch : saveState === 'saved' ? Check : saveState === 'offline' ? CloudSlash : saveState === 'error' ? Warning : CircleNotch
  const pageName = isHome ? t('landingBuilder.pages.home') : page.title || page.slug
  const caps = site.caps

  const leftPanel = (
    <div className="flex h-full flex-col">
      <div className="flex h-11 flex-none items-center gap-1 border-b border-neutral-100 px-2">
        {(['add', 'layers'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setLeftTab(k)} aria-pressed={leftTab === k} data-testid={`left-tab-${k}`} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium ${leftTab === k ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-500 hover:text-neutral-900'}`}>
            {k === 'add' ? <Plus size={14} weight="bold" /> : <ListDashes size={14} />}
            {t(`landingBuilder.left.${k}`)}
          </button>
        ))}
        {mobilePanel === 'left' && <button type="button" onClick={() => setMobilePanel(null)} className="ms-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100" aria-label={t('landingBuilder.actions.close')}><X size={15} /></button>}
      </div>
      <div className="min-h-0 flex-1">
        <LeftPanel
          tab={leftTab}
          doc={doc}
          sections={library?.sections ?? []}
          selectedId={selectedId}
          customCode={caps.custom_code}
          orgslug={org.slug}
          org={org}
          onInsert={(n) => insert(n)}
          onSelect={(id) => { dispatch({ type: 'select', id }); setMobilePanel(null) }}
          onHover={(id) => dispatch({ type: 'hover', id })}
          onMove={(id, parentId, index) => {
            const node = findNode(doc, id)
            const parent = parentId ? findNode(doc, parentId) : null
            if (node && canContain(parent, node)) commit(moveNode(doc, id, parentId, index), undefined, id)
          }}
          onInsertSymbol={(sid) => insert({ id: newId(), type: 'symbol', props: { symbolId: sid }, name: doc.symbols[sid]?.name })}
          onInsertSaved={insertSaved}
          templates={library?.templates}
        />
      </div>
    </div>
  )

  const rightPanel = (
    <Inspector
      doc={doc}
      node={selected}
      breakpoint={breakpoint}
      presets={library?.presets ?? {}}
      customCode={caps.custom_code}
      onDoc={(next, key) => commit(next, key)}
      onSelect={(id) => dispatch({ type: 'select', id })}
      onAction={action}
    />
  )

  return (
    // Full height minus the dashboard's phone tab bar (0 on desktop).
    <div className="flex h-[calc(100dvh-var(--lh-mobile-nav-h,0px))] w-full min-w-0 flex-col bg-[#eceef1] [color-scheme:light]" data-testid="landing-builder">
      {/* Top bar */}
      <header className="z-20 flex h-12 flex-none items-center gap-1.5 border-b border-neutral-200/80 bg-white px-2 sm:px-3">
        <Link href={getUriWithOrg(org.slug, '/dash/website')} className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" aria-label={t('landingBuilder.toolbar.back')} title={t('landingBuilder.toolbar.back')}>
          <ArrowLeft size={16} className="rtl:rotate-180" />
        </Link>
        <div className="relative min-w-0">
          <button type="button" onClick={() => setPagesOpen((v) => !v)} className="inline-flex h-8 max-w-[180px] items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-neutral-900 hover:bg-neutral-100 sm:max-w-[240px]" aria-expanded={pagesOpen} data-testid="pages-menu">
            {isHome ? <House size={15} className="flex-none text-neutral-500" /> : <FileText size={15} className="flex-none text-neutral-500" />}
            <span className="truncate">{pageName}</span>
            <CaretDown size={12} className="flex-none text-neutral-400" />
          </button>
          {pagesOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setPagesOpen(false)} />
              <div className="absolute start-0 top-full z-40 mt-1 w-72 rounded-xl bg-white p-1.5 nice-shadow ring-1 ring-black/5">
                {site.pages.map((p) => (
                  <button key={p.page_uuid} type="button" onClick={() => { setPagesOpen(false); router.push(`${getUriWithOrg(org.slug, '/dash/org/landing-builder')}?page=${p.page_uuid}`) }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] ${p.page_uuid === page.page_uuid ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}>
                    {p.is_home ? <House size={14} className="text-neutral-500" /> : <FileText size={14} className="text-neutral-500" />}
                    <span className="flex-1 min-w-0 truncate text-neutral-800">{p.is_home ? t('landingBuilder.pages.home') : p.title || p.slug}</span>
                    <span className="text-[11px] text-neutral-400">{p.is_home ? '/' : `/p/${p.slug}`}</span>
                  </button>
                ))}
                <div className="my-1 h-px bg-neutral-100" />
                <button type="button" onClick={() => { setPagesOpen(false); setDialog('newpage') }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] text-neutral-700 hover:bg-neutral-50" data-testid="pages-new">
                  <FilePlus size={14} /> {t('landingBuilder.pages.new')}
                </button>
                <button type="button" onClick={() => { setPagesOpen(false); setDialog('templates') }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] text-neutral-700 hover:bg-neutral-50">
                  <Layout size={14} /> {t('landingBuilder.toolbar.templates')}
                </button>
                <button type="button" onClick={() => { setPagesOpen(false); setDialog('submissions') }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] text-neutral-700 hover:bg-neutral-50">
                  <Tray size={14} /> {t('landingBuilder.toolbar.submissions')}
                </button>
              </div>
            </>
          )}
        </div>
        {/* Fixed width: the save status changing must not shift the controls beside it. */}
        <span className={`hidden w-[136px] flex-none items-center gap-1 truncate text-[12px] md:inline-flex ${saveState === 'error' || saveState === 'offline' ? 'text-rose-600' : 'text-neutral-400'}`} data-testid="save-state" data-state={saveState}>
          <SaveIcon size={12} className={saveState === 'saving' ? 'animate-spin' : ''} />
          {saveLabel}
        </span>

        <div className="mx-auto flex items-center rounded-lg bg-neutral-100 p-0.5" role="radiogroup" aria-label={t('landingBuilder.breakpoints.label')}>
          {([['base', Desktop], ['tablet', DeviceTablet], ['mobile', DeviceMobile]] as const).map(([bp, Icon]) => (
            <button key={bp} type="button" role="radio" aria-checked={breakpoint === bp} title={t(`landingBuilder.breakpoints.${bp === 'base' ? 'desktop' : bp}`)} aria-label={t(`landingBuilder.breakpoints.${bp === 'base' ? 'desktop' : bp}`)} onClick={() => dispatch({ type: 'breakpoint', value: bp })} data-testid={`bp-${bp}`} className={`inline-flex h-7 w-8 items-center justify-center rounded-md ${breakpoint === bp ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.05)]' : 'text-neutral-500 hover:text-neutral-800'}`}>
              <Icon size={15} />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5">
          <IconBtn label={t('landingBuilder.toolbar.undo')} onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length} testid="undo"><ArrowArcLeft size={15} className="rtl:-scale-x-100" /></IconBtn>
          <IconBtn label={t('landingBuilder.toolbar.redo')} onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length} testid="redo"><ArrowArcRight size={15} className="rtl:-scale-x-100" /></IconBtn>
          <span className="hidden sm:inline-flex"><IconBtn label={t('landingBuilder.toolbar.history')} onClick={() => setDialog('history')} testid="open-history"><ClockCounterClockwise size={15} /></IconBtn></span>
          <span className="hidden sm:inline-flex"><IconBtn label={t('landingBuilder.toolbar.preview')} onClick={openPreview} testid="open-preview"><Eye size={15} /></IconBtn></span>
        </div>
        <div className="hidden items-center gap-1.5 lg:flex">
          <AIButton size="sm" variant="soft" onClick={() => setDialog('ai')}>{t('landingBuilder.toolbar.ai')}</AIButton>
          <LandingAskAtlas pageUuid={page.page_uuid} pageTitle={pageName} />
        </div>
        <Button variant="primary" size="sm" icon={<Rocket size={13} />} onClick={async () => { await flush(); setDialog('publish') }} data-testid="open-publish">
          <span className="hidden sm:inline">{t('landingBuilder.toolbar.publish')}</span>
        </Button>
      </header>

      {page.review && (
        <div className="z-10 flex flex-none flex-wrap items-center gap-2 border-b border-violet-200/70 bg-violet-50 px-3 py-2 text-[13px] text-violet-900" data-testid="review-bar">
          <span className="font-medium">{page.review.by === 'atlas' ? t('landingBuilder.review.atlas_changed', { count: page.review.changes?.length || 1 }) : t('landingBuilder.review.api_changed', { count: page.review.changes?.length || 1 })}</span>
          <span className="hidden truncate text-violet-700/80 md:inline">{page.review.changes?.[page.review.changes.length - 1]?.summary}</span>
          <div className="ms-auto flex items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={openReview}>{t('landingBuilder.review.review')}</Button>
            <Button size="sm" variant="ghost" onClick={async () => { const d = await resolveLandingReview(page.page_uuid, 'discard', token); loadDetail(d); toast.success(t('landingBuilder.review.discarded')) }}>{t('landingBuilder.review.discard')}</Button>
            <Button size="sm" variant="primary" onClick={async () => { const d = await resolveLandingReview(page.page_uuid, 'keep', token); onReload(d) }}>{t('landingBuilder.review.keep')}</Button>
          </div>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <aside className="hidden w-[272px] flex-none border-e border-neutral-200/80 bg-white lg:block">{leftPanel}</aside>
        <main className="min-w-0 flex-1">
          <Canvas
            doc={doc}
            breakpoint={breakpoint}
            selectedId={selectedId}
            hoverId={state.hoverId}
            editingId={state.editingId}
            highlight={dialog === 'review' ? undefined : reviewDiff && page.review ? reviewDiff.ids : undefined}
            orgslug={org.slug}
            org={org}
            accessToken={token}
            onSelect={(id) => dispatch({ type: 'select', id })}
            onHover={(id) => dispatch({ type: 'hover', id })}
            onEdit={(id) => dispatch({ type: 'edit', id })}
            onTextCommit={onTextCommit}
            onDrop={onDrop}
            onAction={action}
            onAddFirst={() => setDialog('templates')}
          />
        </main>
        <aside className="hidden w-[300px] flex-none border-s border-neutral-200/80 bg-white lg:block" data-testid="inspector">{rightPanel}</aside>

        {/* Phones and tablets: panels slide over the canvas. */}
        <div className="absolute bottom-3 start-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-neutral-900 p-1 shadow-lg rtl:translate-x-1/2 lg:hidden">
          <button type="button" onClick={() => setMobilePanel(mobilePanel === 'left' ? null : 'left')} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-white hover:bg-white/10" data-testid="mobile-left">
            <Plus size={14} weight="bold" /> {t('landingBuilder.left.add')}
          </button>
          <button type="button" onClick={() => setMobilePanel(mobilePanel === 'right' ? null : 'right')} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-white hover:bg-white/10" data-testid="mobile-right">
            <SlidersHorizontal size={14} /> {selected ? t('landingBuilder.inspector.edit') : t('landingBuilder.theme.title')}
          </button>
          <button type="button" onClick={() => setDialog('ai')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-white/10" aria-label={t('landingBuilder.toolbar.ai')}>
            <img src="/learnhouse_ai_simple_colored.png" alt="" className="h-4 w-4" />
          </button>
        </div>
        {mobilePanel && (
          <>
            <div className="absolute inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setMobilePanel(null)} />
            <div className={`absolute bottom-0 top-0 z-30 w-[min(340px,92vw)] bg-white shadow-xl lg:hidden ${mobilePanel === 'left' ? 'start-0' : 'end-0'}`}>
              {mobilePanel === 'left' ? leftPanel : (
                <div className="flex h-full flex-col">
                  <div className="flex h-11 flex-none items-center justify-end border-b border-neutral-100 px-2"><button type="button" onClick={() => setMobilePanel(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100" aria-label={t('landingBuilder.actions.close')}><X size={15} /></button></div>
                  <div className="min-h-0 flex-1">{rightPanel}</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <SaveSectionDialog
        open={dialog === 'save-section'}
        section={selectedSection}
        onClose={() => setDialog(null)}
        onSave={async (name) => {
          if (!selectedSection) return
          try {
            await saveLandingSection(org.id, { name, node: selectedSection, symbols: doc.symbols }, token)
            queryClient.invalidateQueries({ queryKey: landingQueryKeys.saved(org.id) })
            toast.success(t('landingBuilder.library.saved_toast'))
            setDialog(null)
          } catch (e: any) {
            toast.error(e?.message || t('landingBuilder.toasts.load_failed'))
          }
        }}
      />
      <TemplatePicker
        open={dialog === 'templates'}
        onClose={() => setDialog(null)}
        templates={library?.templates ?? []}
        orgId={org.id}
        token={token}
        orgslug={org.slug}
        org={org}
        onAI={() => setDialog('ai')}
        onBlank={() => {
          if (!doc.root.length) commit({ ...emptyDoc(), root: [] })
          setDialog(null)
        }}
        onPick={async (id, palette) => {
          setDialog(null)
          await flush()
          try {
            loadDetail(await applyLandingTemplate(page.page_uuid, id, revision.current, token, palette))
            toast.success(t('landingBuilder.toasts.template_applied'))
          } catch (e: any) {
            if (e?.status === 409) setConflict(true)
            else toast.error(t('landingBuilder.toasts.load_failed'))
          }
        }}
      />
      <PublishDialog open={dialog === 'publish'} onClose={() => setDialog(null)} draft={doc} live={page.published_doc ? asDoc(page.published_doc) : null} onPublish={publish} />
      <HistoryDialog
        open={dialog === 'history'}
        onClose={() => setDialog(null)}
        pageUuid={page.page_uuid}
        token={token}
        orgslug={org.slug}
        org={org}
        current={doc}
        onRestore={async (v) => {
          await flush()
          loadDetail(await restoreLandingVersion(v, token))
          toast.success(t('landingBuilder.toasts.restored'))
        }}
        onSaveVariant={async (label) => {
          await flush()
          await saveLandingVariant(page.page_uuid, label, token)
          toast.success(t('landingBuilder.toasts.variant_saved'))
        }}
      />
      <AIDialog
        open={dialog === 'ai'}
        onClose={() => setDialog(null)}
        onGenerate={async (brief) => {
          await flush()
          loadDetail(await generateLandingWithAI(org.id, { page_uuid: page.page_uuid, brief, base_revision: revision.current }, token))
          toast.success(t('landingBuilder.toasts.generated'))
        }}
      />
      <NewPageDialog
        open={dialog === 'newpage'}
        onClose={() => setDialog(null)}
        caps={caps}
        templates={library?.templates ?? []}
        onCreate={async (body) => {
          try {
            const detail = await createLandingPage(org.id, body, token)
            queryClient.invalidateQueries({ queryKey: landingQueryKeys.site(org.id) })
            router.push(`${getUriWithOrg(org.slug, '/dash/org/landing-builder')}?page=${detail.page_uuid}`)
          } catch (e: any) {
            toast.error(e?.message || t('landingBuilder.toasts.load_failed'))
            throw e
          }
        }}
      />
      <SubmissionsDialog open={dialog === 'submissions'} onClose={() => setDialog(null)} orgId={org.id} token={token} />
      {dialog === 'review' && reviewDiff && (
        <ReviewSheet onClose={() => setDialog(null)} diff={reviewDiff} onDiscard={async () => { const d = await resolveLandingReview(page.page_uuid, 'discard', token); loadDetail(d); setDialog(null) }} onKeep={async () => { const d = await resolveLandingReview(page.page_uuid, 'keep', token); onReload(d); setDialog(null) }} onPublish={async () => { setDialog('publish') }} />
      )}
      <ConflictDialog
        open={conflict}
        onReload={async () => {
          setConflict(false)
          loadDetail(await getLandingPage(page.page_uuid, token))
        }}
        onOverwrite={async () => {
          setConflict(false)
          await save(true)
        }}
      />
    </div>
  )
}

function SaveSectionDialog({ open, section, onClose, onSave }: { open: boolean; section: LandingNode | null; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (open) setName(section?.name || '')
  }, [open, section])
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      dialogTitle={t('landingBuilder.library.save_title')}
      dialogDescription={t('landingBuilder.library.save_subtitle')}
      dialogContent={
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-neutral-500">{t('landingBuilder.library.save_name')}</span>
          <input className="h-9 rounded-lg bg-white px-3 text-[13px] ring-1 ring-inset ring-neutral-200 outline-none focus:ring-neutral-400" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="save-section-name" autoFocus />
        </label>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('landingBuilder.actions.cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!section} onClick={async () => { setBusy(true); try { await onSave(name.trim() || section?.name || t('landingBuilder.elements.section')) } finally { setBusy(false) } }} data-testid="save-section-confirm">
            {t('landingBuilder.library.save_confirm')}
          </Button>
        </>
      }
    />
  )
}

function ReviewSheet({ onClose, diff, onDiscard, onKeep, onPublish }: { onClose: () => void; diff: ReturnType<typeof diffDocs>; onDiscard: () => void; onKeep: () => void; onPublish: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={t('landingBuilder.review.title')}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 nice-shadow">
        <div className="mb-1 text-[15px] font-semibold text-neutral-900">{t('landingBuilder.review.title')}</div>
        <p className="mb-3 text-[13px] text-neutral-500">{t('landingBuilder.review.subtitle')}</p>
        <DiffList diff={diff} />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('landingBuilder.actions.close')}</Button>
          <Button variant="danger-ghost" onClick={onDiscard}>{t('landingBuilder.review.discard')}</Button>
          <Button variant="secondary" onClick={onKeep}>{t('landingBuilder.review.keep')}</Button>
          <Button variant="primary" icon={<Rocket size={13} />} onClick={onPublish}>{t('landingBuilder.review.publish')}</Button>
        </div>
      </div>
    </div>
  )
}

function useSite(orgId?: number, token?: string) {
  return useQuery({ queryKey: landingQueryKeys.site(orgId), queryFn: () => getLandingSite(orgId!, token), enabled: !!orgId && !!token })
}

export default function LandingBuilder() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const params = useSearchParams()
  const queryClient = useQueryClient()
  const site = useSite(org?.id, token)
  const pageUuid = params?.get('page') || site.data?.pages.find((p) => p.is_home)?.page_uuid
  const page = useQuery({ queryKey: landingQueryKeys.page(pageUuid), queryFn: () => getLandingPage(pageUuid!, token), enabled: !!pageUuid && !!token, staleTime: Infinity, refetchOnWindowFocus: false })
  if (site.isError || page.isError) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 p-6 text-center">
        <Warning size={28} className="text-rose-500" />
        <p className="text-[14px] font-semibold text-neutral-800">{t('landingBuilder.load_error')}</p>
        <Button variant="secondary" onClick={() => { site.refetch(); page.refetch() }}>{t('landingBuilder.actions.retry')}</Button>
      </div>
    )
  }
  if (!site.data || !page.data) {
    return (
      <div className="flex h-[100dvh] flex-col bg-[#eceef1]">
        <div className="h-12 border-b border-neutral-200/80 bg-white" />
        <div className="flex flex-1 items-center justify-center"><CircleNotch size={22} className="animate-spin text-neutral-400" /></div>
      </div>
    )
  }
  return (
    <Editor
      key={page.data.page_uuid}
      page={page.data}
      site={site.data}
      onReload={(detail) => {
        // The editor keeps its own document; the cached page carries the
        // server facts (revision, published copy, review, preview link).
        if (detail) queryClient.setQueryData(landingQueryKeys.page(detail.page_uuid), detail)
        queryClient.invalidateQueries({ queryKey: landingQueryKeys.site(org.id) })
      }}
    />
  )
}
