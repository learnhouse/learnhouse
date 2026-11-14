'use client'
/**
 * Renders a landing page document. The same component draws the public page,
 * the builder canvas and template thumbnails, so what the builder shows is
 * what visitors get.
 *
 * Client-rendered like the rest of the public org pages. Light elements ship
 * with this chunk; live-data blocks, forms, markdown, embeds and custom code
 * load on demand, only when a page uses them.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { LandingDoc, LandingNode } from '../model/types'
import { docCss, pageBackground, pageScheme, themeFontsUrl, themeVars } from '../model/style'
import { BASE_CSS } from './baseCss'
import { useColorScheme } from '@components/Contexts/ColorSchemeContext'
import { readOrgTheme } from '@/lib/theme/orgTheme'
import { RenderContext, type RenderContextValue, type RenderLabels, type RenderMode, useRender } from './context'
import {
  ButtonEl, ColumnsEl, ContainerEl, CountdownEl, DividerEl, FaqEl, FeaturesEl, FooterEl, GalleryEl, HeadingEl, IconEl,
  ImageEl, InstructorsEl, ListEl, LogosEl, NavbarEl, SectionEl, SpacerEl, StatsEl, StepsEl, TestimonialsEl, TextEl, VideoEl,
} from './elements'

const data = () => import('./dataBlocks')
const forms = () => import('./formBlocks')
const rich = () => import('./richBlocks')

const LAZY = {
  courses: React.lazy(() => data().then((m) => ({ default: m.CoursesBlock }))),
  course: React.lazy(() => data().then((m) => ({ default: m.CourseBlock }))),
  paths: React.lazy(() => data().then((m) => ({ default: m.PathsBlock }))),
  communities: React.lazy(() => data().then((m) => ({ default: m.CommunitiesBlock }))),
  podcasts: React.lazy(() => data().then((m) => ({ default: m.PodcastsBlock }))),
  live_sessions: React.lazy(() => data().then((m) => ({ default: m.LiveSessionsBlock }))),
  pricing: React.lazy(() => data().then((m) => ({ default: m.PricingBlock }))),
  newsletter: React.lazy(() => forms().then((m) => ({ default: m.NewsletterBlock }))),
  form: React.lazy(() => forms().then((m) => ({ default: m.ContactFormBlock }))),
  richtext: React.lazy(() => rich().then((m) => ({ default: m.RichTextBlock }))),
  embed: React.lazy(() => rich().then((m) => ({ default: m.EmbedBlock }))),
  html: React.lazy(() => rich().then((m) => ({ default: m.HtmlBlock }))),
} as const

const EAGER: Partial<Record<string, React.ComponentType<{ node: LandingNode; children?: React.ReactNode }>>> = {
  section: SectionEl,
  container: ContainerEl,
  columns: ColumnsEl,
  heading: HeadingEl,
  text: TextEl,
  image: ImageEl,
  video: VideoEl,
  button: ButtonEl,
  icon: IconEl,
  divider: DividerEl,
  spacer: SpacerEl,
  list: ListEl,
  features: FeaturesEl,
  testimonials: TestimonialsEl,
  faq: FaqEl,
  stats: StatsEl,
  logos: LogosEl,
  steps: StepsEl,
  gallery: GalleryEl,
  countdown: CountdownEl,
  instructors: InstructorsEl,
  navbar: NavbarEl,
  footer: FooterEl,
}

/** One broken element must not blank the page. */
class NodeBoundary extends React.Component<{ children: React.ReactNode; id: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidUpdate(prev: { id: string }) {
    if (prev.id !== this.props.id && this.state.failed) this.setState({ failed: false })
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function inSchedule(node: LandingNode, now: number): boolean {
  const from = node.schedule?.from ? Date.parse(node.schedule.from) : NaN
  const until = node.schedule?.until ? Date.parse(node.schedule.until) : NaN
  if (!Number.isNaN(from) && now < from) return false
  if (!Number.isNaN(until) && now >= until) return false
  return true
}

export const NodeView = React.memo(function NodeView({ node, depth = 0 }: { node: LandingNode; depth?: number }) {
  const ctx = useRender()
  if (!node || typeof node !== 'object' || depth > 14) return null
  if (ctx.mode !== 'canvas') {
    if (!inSchedule(node, Date.now())) return null
    const vis = node.visibility || 'everyone'
    if (vis !== 'everyone') {
      if (ctx.session === 'loading') return null
      if (vis === 'logged_in' ? ctx.session !== 'authenticated' : ctx.session !== 'unauthenticated') return null
    }
  }
  if (node.type === 'symbol') {
    const sym = ctx.doc.symbols?.[node.props?.symbolId]
    if (!sym?.node || sym.node.type === 'symbol') return null
    return <NodeView node={sym.node} depth={depth + 1} />
  }
  const Lazy = (LAZY as unknown as Record<string, React.ComponentType<{ node: LandingNode }> | undefined>)[node.type]
  if (Lazy) {
    return (
      <NodeBoundary id={node.id}>
        <React.Suspense fallback={<div className={`lhp-${node.id}`} style={{ minHeight: 120 }} />}>
          <Lazy node={node} />
        </React.Suspense>
      </NodeBoundary>
    )
  }
  const El = EAGER[node.type]
  if (!El) return null
  const kids = node.children?.length ? node.children.map((c) => <NodeView key={c.id} node={c} depth={depth + 1} />) : null
  return (
    <NodeBoundary id={node.id}>
      <El node={node}>{kids}</El>
    </NodeBoundary>
  )
})

export function useRenderLabels(): RenderLabels {
  const { t } = useTranslation()
  return React.useMemo(
    () => ({
      courses_empty: t('landingBuilder.render.courses_empty'),
      sign_in: t('landingBuilder.render.sign_in'),
      loading: t('landingBuilder.render.loading'),
      view_course: t('landingBuilder.render.view'),
      start_learning: t('landingBuilder.render.start_learning'),
      lessons: t('landingBuilder.render.courses_label'),
      subscribe_success: t('landingBuilder.render.subscribe_success'),
      form_success: t('landingBuilder.render.form_success'),
      form_error: t('landingBuilder.render.form_error'),
      sending: t('landingBuilder.render.sending'),
      menu: t('landingBuilder.render.menu'),
      placeholder_image: t('landingBuilder.render.placeholder_image'),
      placeholder_embed: t('landingBuilder.render.placeholder_embed'),
      placeholder_newsletter: t('landingBuilder.render.placeholder_newsletter'),
      placeholder_newsletter_form: t('landingBuilder.render.placeholder_newsletter_form'),
      placeholder_course: t('landingBuilder.render.placeholder_course'),
      placeholder_data: t('landingBuilder.render.placeholder_data'),
      countdown: [t('landing.countdown.days'), t('landing.countdown.hours'), t('landing.countdown.minutes'), t('landing.countdown.seconds')],
      pricing_from: t('landing.pricing.from'),
      pricing_month: t('landing.pricing.per_month'),
      pricing_year: t('landing.pricing.per_year'),
      pricing_subscription: t('landing.pricing.subscription'),
      custom_code: t('landingBuilder.render.custom_code'),
      required: t('landingBuilder.render.required'),
    }),
    [t]
  )
}

/** Plays entrance animations as elements scroll into view (public mode). */
function useEntranceAnimations(root: React.RefObject<HTMLDivElement | null>, mode: RenderMode, doc: LandingDoc) {
  React.useEffect(() => {
    if (mode !== 'public' || !root.current) return
    const els = Array.from(root.current.querySelectorAll<HTMLElement>('[data-anim]'))
    if (!els.length) return
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.classList.add('lhp-in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('lhp-in')
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px' }
    )
    els.forEach((el) => io.observe(el))
    // Never leave content invisible if the observer misses something.
    const fallback = setTimeout(() => els.forEach((el) => el.classList.add('lhp-in')), 4000)
    return () => {
      io.disconnect()
      clearTimeout(fallback)
    }
  }, [mode, root, doc])
}

function useThemeFonts(url: string | null) {
  React.useEffect(() => {
    if (!url || typeof document === 'undefined') return
    const id = `lhp-font-${btoa(url).slice(0, 24)}`
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = url
    document.head.appendChild(link)
  }, [url])
}

export interface LandingRendererProps {
  doc: LandingDoc
  mode: RenderMode
  orgslug: string
  org: any
  session?: RenderContextValue['session']
  accessToken?: string
  pageSlug?: string
  editingId?: string | null
  onTextCommit?: RenderContextValue['onTextCommit']
  onTextCancel?: RenderContextValue['onTextCancel']
  className?: string
  /** Canvas: render this subtree instead of the page (symbol editing). */
  rootOverride?: LandingNode[]
  /** Force the light or dark palette (builder and gallery previews). */
  scheme?: 'light' | 'dark'
}

/**
 * Whether the page renders its dark palette. Org-designed pages keep their
 * design unless they define a dark palette (theme.dark); then they follow the
 * visitor's dark mode, unless the org forces its public pages light.
 */
export function useDarkPalette(doc: LandingDoc, org: any, mode: RenderMode, forced?: 'light' | 'dark'): boolean {
  const ctx = useColorScheme() as { colorScheme?: string } | undefined
  if (!doc.theme.dark) return false
  if (forced) return forced === 'dark'
  if (mode !== 'public') return false
  if (readOrgTheme(org).theme.public_scheme === 'light') return false
  return ctx?.colorScheme === 'dark'
}

export default function LandingRenderer(props: LandingRendererProps) {
  const { doc, mode } = props
  const labels = useRenderLabels()
  const ref = React.useRef<HTMLDivElement>(null)
  const css = React.useMemo(() => docCss(doc, { canvas: mode === 'canvas' }), [doc, mode])
  const dark = useDarkPalette(doc, props.org, mode, props.scheme)
  const vars = React.useMemo(() => themeVars(doc.theme, dark), [doc.theme, dark])
  useThemeFonts(React.useMemo(() => themeFontsUrl(doc), [doc]))
  useEntranceAnimations(ref, mode, doc)
  const value = React.useMemo<RenderContextValue>(
    () => ({
      mode,
      doc,
      orgslug: props.orgslug,
      org: props.org,
      session: props.session || 'unauthenticated',
      accessToken: props.accessToken,
      pageSlug: props.pageSlug || '',
      labels,
      editingId: props.editingId,
      onTextCommit: props.onTextCommit,
      onTextCancel: props.onTextCancel,
    }),
    [mode, doc, props.orgslug, props.org, props.session, props.accessToken, props.pageSlug, labels, props.editingId, props.onTextCommit, props.onTextCancel]
  )
  const nodes = props.rootOverride || doc.root
  return (
    <RenderContext.Provider value={value}>
      <style data-lhp="base">{BASE_CSS}</style>
      <style data-lhp="page">{css}</style>
      <div
        ref={ref}
        className={`lhp-root${props.className ? ` ${props.className}` : ''}`}
        data-mode={mode}
        data-btn={doc.theme.buttonStyle}
        data-scheme={pageScheme(doc, dark)}
        data-palette={dark ? 'dark' : undefined}
        // Org-designed content keeps its own colors in the app's dark mode.
        data-lh-user-content=""
        style={{ ...(vars as React.CSSProperties), ...pageBackground(doc.page, dark) }}
      >
        {nodes.map((n) => <NodeView key={n.id} node={n} />)}
      </div>
    </RenderContext.Provider>
  )
}
