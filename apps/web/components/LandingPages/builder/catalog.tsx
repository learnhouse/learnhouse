'use client'
/**
 * The element catalog: what the library offers, each element's default
 * content, and the fields the content panel shows for it.
 */
import React from 'react'
import {
  Article, Browser, CalendarBlank, ChatCircleText, Circuitry, Code, Columns, CurrencyCircleDollar, Cursor, DotsThreeOutline,
  EnvelopeSimple, FilmStrip, Garage, GraduationCap, Image as ImageIcon, ImagesSquare, Layout, ListBullets, ListNumbers,
  Microphone, Minus, NumberSquareOne, Question, Quotes, Rows, Square, Star, TextAa, TextHOne, Timer, TrendUp, UsersThree,
  VideoCamera, Wall, FrameCorners, ArrowsOutLineVertical, BookOpenText,
} from '@phosphor-icons/react'
import type { ElementType, LandingNode } from '../model/types'
import { newId } from '../model/tree'

export type CatalogGroup = 'layout' | 'basic' | 'media' | 'content' | 'data' | 'forms' | 'navigation' | 'advanced'

export interface CatalogEntry {
  key: string
  type: ElementType
  group: CatalogGroup
  icon: React.ComponentType<any>
  /** Tailwind classes for the icon tile (colorful, like the rest of the app). */
  tone: string
  make: (t: (k: string) => string) => LandingNode
  plan?: 'pro'
}

const n = (type: ElementType, props: Record<string, any> = {}, style?: LandingNode['style'], children?: LandingNode[]): LandingNode => ({
  id: newId(),
  type,
  props,
  ...(style ? { style } : {}),
  ...(children ? { children } : {}),
})

const column = (kids: LandingNode[] = []) => n('container', {}, { base: { display: 'flex', flexDirection: 'column', gap: 16 } }, kids)

export const CATALOG: CatalogEntry[] = [
  {
    key: 'section', type: 'section', group: 'layout', icon: Rows, tone: 'bg-sky-50 text-sky-600',
    make: (t) => n('section', { tag: 'section' }, { base: { paddingTop: 80, paddingBottom: 80, paddingLeft: 24, paddingRight: 24 }, mobile: { paddingTop: 48, paddingBottom: 48, paddingLeft: 16, paddingRight: 16 } }, [
      n('container', {}, { base: { maxWidth: 'content', marginLeft: 'auto', marginRight: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 24 } }, [
        n('heading', { text: t('landingBuilder.defaults.heading'), level: 2 }),
        n('text', { text: t('landingBuilder.defaults.text') }, { base: { opacity: 0.75, fontSize: '1.125rem' } }),
      ]),
    ]),
  },
  { key: 'container', type: 'container', group: 'layout', icon: Square, tone: 'bg-sky-50 text-sky-600', make: () => n('container', {}, { base: { display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 24, paddingBottom: 24, paddingLeft: 24, paddingRight: 24, borderRadius: 16, backgroundColor: '$surface' } }, []) },
  { key: 'columns2', type: 'columns', group: 'layout', icon: Columns, tone: 'bg-sky-50 text-sky-600', make: () => n('columns', { ratio: 'equal', stackAt: 'mobile' }, { base: { gap: 32 } }, [column(), column()]) },
  { key: 'columns3', type: 'columns', group: 'layout', icon: Layout, tone: 'bg-sky-50 text-sky-600', make: () => n('columns', { ratio: 'equal', stackAt: 'tablet' }, { base: { gap: 24 } }, [column(), column(), column()]) },
  { key: 'heading', type: 'heading', group: 'basic', icon: TextHOne, tone: 'bg-violet-50 text-violet-600', make: (t) => n('heading', { text: t('landingBuilder.defaults.heading'), level: 2 }) },
  { key: 'text', type: 'text', group: 'basic', icon: TextAa, tone: 'bg-violet-50 text-violet-600', make: (t) => n('text', { text: t('landingBuilder.defaults.text') }) },
  { key: 'richtext', type: 'richtext', group: 'basic', icon: Article, tone: 'bg-violet-50 text-violet-600', make: (t) => n('richtext', { markdown: t('landingBuilder.defaults.markdown') }) },
  { key: 'button', type: 'button', group: 'basic', icon: Cursor, tone: 'bg-violet-50 text-violet-600', make: (t) => n('button', { label: t('landingBuilder.defaults.button'), href: '/courses', variant: 'primary', size: 'md' }) },
  { key: 'list', type: 'list', group: 'basic', icon: ListBullets, tone: 'bg-violet-50 text-violet-600', make: (t) => n('list', { items: [t('landingBuilder.defaults.list_item'), t('landingBuilder.defaults.list_item'), t('landingBuilder.defaults.list_item')], marker: 'check' }) },
  { key: 'icon', type: 'icon', group: 'basic', icon: Star, tone: 'bg-violet-50 text-violet-600', make: () => n('icon', { name: 'Sparkle', size: 40, weight: 'duotone' }, { base: { color: '$primary' } }) },
  { key: 'divider', type: 'divider', group: 'basic', icon: Minus, tone: 'bg-violet-50 text-violet-600', make: () => n('divider') },
  { key: 'spacer', type: 'spacer', group: 'basic', icon: ArrowsOutLineVertical, tone: 'bg-violet-50 text-violet-600', make: () => n('spacer', { size: 48 }) },
  { key: 'image', type: 'image', group: 'media', icon: ImageIcon, tone: 'bg-emerald-50 text-emerald-600', make: () => n('image', { src: '', alt: '' }, { base: { borderRadius: 16, width: '100%' } }) },
  { key: 'video', type: 'video', group: 'media', icon: VideoCamera, tone: 'bg-emerald-50 text-emerald-600', make: () => n('video', { url: '' }, { base: { borderRadius: 16, overflow: 'hidden' } }) },
  { key: 'gallery', type: 'gallery', group: 'media', icon: ImagesSquare, tone: 'bg-emerald-50 text-emerald-600', make: () => n('gallery', { images: [], columns: 3 }) },
  { key: 'embed', type: 'embed', group: 'media', icon: FrameCorners, tone: 'bg-emerald-50 text-emerald-600', make: () => n('embed', { url: '', height: 480 }) },
  {
    key: 'features', type: 'features', group: 'content', icon: DotsThreeOutline, tone: 'bg-amber-50 text-amber-600',
    make: (t) => n('features', { columns: 3, layout: 'cards', items: [1, 2, 3].map((i) => ({ icon: ['Lightning', 'Certificate', 'ChatsCircle'][i - 1], title: t('landingBuilder.defaults.feature_title'), text: t('landingBuilder.defaults.feature_text') })) }),
  },
  {
    key: 'testimonials', type: 'testimonials', group: 'content', icon: Quotes, tone: 'bg-amber-50 text-amber-600',
    make: (t) => n('testimonials', { layout: 'grid', columns: 3, items: [1, 2, 3].map(() => ({ quote: t('landingBuilder.defaults.quote'), author: t('landingBuilder.defaults.author'), role: '', rating: 5 })) }),
  },
  { key: 'faq', type: 'faq', group: 'content', icon: Question, tone: 'bg-amber-50 text-amber-600', make: (t) => n('faq', { layout: 'accordion', items: [1, 2, 3].map(() => ({ question: t('landingBuilder.defaults.question'), answer: t('landingBuilder.defaults.answer') })) }) },
  { key: 'stats', type: 'stats', group: 'content', icon: TrendUp, tone: 'bg-amber-50 text-amber-600', make: (t) => n('stats', { layout: 'row', items: [{ value: '10k+', label: t('landingBuilder.defaults.stat_learners') }, { value: '50+', label: t('landingBuilder.defaults.stat_courses') }, { value: '4.9', label: t('landingBuilder.defaults.stat_rating') }] }) },
  { key: 'logos', type: 'logos', group: 'content', icon: Wall, tone: 'bg-amber-50 text-amber-600', make: () => n('logos', { items: [], grayscale: true, size: 'md' }) },
  { key: 'steps', type: 'steps', group: 'content', icon: ListNumbers, tone: 'bg-amber-50 text-amber-600', make: (t) => n('steps', { layout: 'horizontal', items: [1, 2, 3].map(() => ({ title: t('landingBuilder.defaults.step_title'), text: t('landingBuilder.defaults.step_text') })) }) },
  { key: 'countdown', type: 'countdown', group: 'content', icon: Timer, tone: 'bg-amber-50 text-amber-600', make: () => n('countdown', { target: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16), doneText: '' }) },
  { key: 'instructors', type: 'instructors', group: 'content', icon: UsersThree, tone: 'bg-amber-50 text-amber-600', make: (t) => n('instructors', { layout: 'cards', columns: 3, people: [1, 2, 3].map(() => ({ name: t('landingBuilder.defaults.author'), role: t('landingBuilder.defaults.role'), bio: '' })) }) },
  { key: 'courses', type: 'courses', group: 'data', icon: GraduationCap, tone: 'bg-rose-50 text-rose-600', make: () => n('courses', { source: 'latest', limit: 6, columns: 3, layout: 'grid' }) },
  { key: 'course', type: 'course', group: 'data', icon: BookOpenText, tone: 'bg-rose-50 text-rose-600', make: () => n('course', { courseUuid: '', layout: 'split' }) },
  { key: 'paths', type: 'paths', group: 'data', icon: Circuitry, tone: 'bg-rose-50 text-rose-600', make: () => n('paths', { source: 'latest', limit: 3, columns: 3 }) },
  { key: 'communities', type: 'communities', group: 'data', icon: Garage, tone: 'bg-rose-50 text-rose-600', make: () => n('communities', { limit: 3, columns: 3 }) },
  { key: 'podcasts', type: 'podcasts', group: 'data', icon: Microphone, tone: 'bg-rose-50 text-rose-600', make: () => n('podcasts', { limit: 3, columns: 3 }) },
  { key: 'live_sessions', type: 'live_sessions', group: 'data', icon: CalendarBlank, tone: 'bg-rose-50 text-rose-600', make: () => n('live_sessions', { limit: 4, layout: 'list' }) },
  {
    key: 'pricing', type: 'pricing', group: 'data', icon: CurrencyCircleDollar, tone: 'bg-rose-50 text-rose-600',
    make: (t) => n('pricing', { columns: 2, plans: [
      { name: t('landingBuilder.defaults.plan_free'), price: '$0', period: '', description: '', features: [t('landingBuilder.defaults.list_item')], highlighted: false, badge: '', button: { label: t('landingBuilder.defaults.button'), href: '/signup' } },
      { name: t('landingBuilder.defaults.plan_pro'), price: '$19', period: '/ mo', description: '', features: [t('landingBuilder.defaults.list_item'), t('landingBuilder.defaults.list_item')], highlighted: true, badge: '', button: { label: t('landingBuilder.defaults.button'), href: '/signup' } },
    ] }),
  },
  {
    key: 'form', type: 'form', group: 'forms', icon: ChatCircleText, tone: 'bg-indigo-50 text-indigo-600',
    make: (t) => n('form', { submitLabel: t('landingBuilder.defaults.submit'), successText: t('landingBuilder.defaults.form_success'), fields: [
      { key: 'name', label: t('landingBuilder.defaults.field_name'), type: 'text', required: true },
      { key: 'email', label: t('landingBuilder.defaults.field_email'), type: 'email', required: true },
      { key: 'message', label: t('landingBuilder.defaults.field_message'), type: 'textarea', required: true },
    ] }, { base: { maxWidth: '560px', width: '100%' } }),
  },
  { key: 'newsletter', type: 'newsletter', group: 'forms', icon: EnvelopeSimple, tone: 'bg-indigo-50 text-indigo-600', make: (t) => n('newsletter', { newsletterSlug: '', placeholder: 'you@example.com', buttonLabel: t('landingBuilder.defaults.subscribe'), successText: '', layout: 'inline' }, { base: { maxWidth: '480px', width: '100%' } }) },
  { key: 'navbar', type: 'navbar', group: 'navigation', icon: Browser, tone: 'bg-teal-50 text-teal-600', make: (t) => n('navbar', { variant: 'simple', showLogo: true, links: [{ label: t('landingBuilder.defaults.nav_courses'), href: '/courses' }], cta: { label: t('landingBuilder.defaults.nav_signup'), href: '/signup' } }) },
  { key: 'footer', type: 'footer', group: 'navigation', icon: NumberSquareOne, tone: 'bg-teal-50 text-teal-600', make: () => n('footer', { variant: 'simple', showLogo: true, text: '', columns: [], social: [], copyright: `© ${new Date().getFullYear()}` }) },
  { key: 'html', type: 'html', group: 'advanced', icon: Code, tone: 'bg-neutral-100 text-neutral-700', make: () => n('html', { html: '<div class="box">Hello</div>', css: '.box{padding:24px;border-radius:12px;background:#f1f5f9}', height: 160 }), plan: 'pro' },
]

export const CATALOG_BY_TYPE: Partial<Record<ElementType, CatalogEntry>> = Object.fromEntries(CATALOG.map((e) => [e.type, e]))
CATALOG_BY_TYPE.columns = CATALOG.find((e) => e.key === 'columns2')
export const GROUPS: CatalogGroup[] = ['layout', 'basic', 'media', 'content', 'data', 'forms', 'navigation', 'advanced']

/** The icon of an element type, as an element (not a component made during render). */
export function TypeIcon({ type, ...rest }: { type: string; size?: number; weight?: any; className?: string }) {
  return React.createElement(iconFor(type), rest)
}

export function iconFor(type: string): React.ComponentType<any> {
  if (type === 'symbol') return FilmStrip
  return CATALOG_BY_TYPE[type as ElementType]?.icon || Square
}

/* ── content fields ─────────────────────────────────────────────────────── */

export type Field =
  | { key: string; kind: 'text' | 'textarea' | 'markdown' | 'url' | 'image' | 'video' | 'icon' | 'datetime' | 'code' | 'css' }
  | { key: string; kind: 'number'; min: number; max: number; step?: number }
  | { key: string; kind: 'toggle' }
  | { key: string; kind: 'select'; options: string[] }
  | { key: string; kind: 'strings' }
  | { key: string; kind: 'items'; fields: Field[]; make: () => Record<string, any>; title: string; max?: number }
  | { key: string; kind: 'link' }
  | { key: string; kind: 'courses' | 'course' | 'paths' | 'offer' | 'newsletter' }

const items = (key: string, title: string, fields: Field[], make: () => Record<string, any>, max = 24): Field => ({ key, kind: 'items', title, fields, make, max })
const link = { label: '', href: '' }

export const FIELDS: Partial<Record<ElementType, Field[]>> = {
  section: [{ key: 'tag', kind: 'select', options: ['section', 'header', 'footer', 'div'] }],
  container: [{ key: 'href', kind: 'url' }, { key: 'newTab', kind: 'toggle' }, { key: 'tag', kind: 'select', options: ['div', 'article', 'aside', 'nav'] }],
  columns: [{ key: 'ratio', kind: 'select', options: ['equal', '1:2', '2:1', '1:3', '3:1', '2:3', '3:2'] }, { key: 'stackAt', kind: 'select', options: ['tablet', 'mobile', 'never'] }],
  heading: [{ key: 'text', kind: 'textarea' }, { key: 'level', kind: 'select', options: ['1', '2', '3', '4', '5', '6'] }],
  text: [{ key: 'text', kind: 'textarea' }],
  richtext: [{ key: 'markdown', kind: 'markdown' }],
  image: [{ key: 'src', kind: 'image' }, { key: 'alt', kind: 'text' }, { key: 'caption', kind: 'text' }, { key: 'href', kind: 'url' }, { key: 'newTab', kind: 'toggle' }],
  video: [{ key: 'url', kind: 'video' }, { key: 'poster', kind: 'image' }, { key: 'autoplay', kind: 'toggle' }, { key: 'loop', kind: 'toggle' }, { key: 'muted', kind: 'toggle' }, { key: 'controls', kind: 'toggle' }],
  button: [
    { key: 'label', kind: 'text' }, { key: 'href', kind: 'url' }, { key: 'variant', kind: 'select', options: ['primary', 'secondary', 'outline', 'ghost', 'link'] },
    { key: 'size', kind: 'select', options: ['sm', 'md', 'lg'] }, { key: 'icon', kind: 'icon' }, { key: 'iconPosition', kind: 'select', options: ['start', 'end'] },
    { key: 'newTab', kind: 'toggle' }, { key: 'fullWidth', kind: 'toggle' },
  ],
  icon: [{ key: 'name', kind: 'icon' }, { key: 'size', kind: 'number', min: 12, max: 160 }, { key: 'weight', kind: 'select', options: ['regular', 'bold', 'duotone', 'fill', 'light'] }],
  spacer: [{ key: 'size', kind: 'number', min: 0, max: 400, step: 4 }],
  embed: [{ key: 'url', kind: 'url' }, { key: 'title', kind: 'text' }, { key: 'height', kind: 'number', min: 100, max: 2000, step: 10 }, { key: 'aspect', kind: 'select', options: ['', '16/9', '4/3', '1/1', '9/16'] }],
  list: [{ key: 'items', kind: 'strings' }, { key: 'marker', kind: 'select', options: ['check', 'dot', 'number', 'none'] }],
  html: [{ key: 'html', kind: 'code' }, { key: 'css', kind: 'css' }, { key: 'height', kind: 'number', min: 40, max: 4000, step: 10 }],
  courses: [
    { key: 'source', kind: 'select', options: ['latest', 'selected', 'all'] }, { key: 'courseUuids', kind: 'courses' },
    { key: 'limit', kind: 'number', min: 1, max: 48 }, { key: 'layout', kind: 'select', options: ['grid', 'carousel', 'list'] },
    { key: 'columns', kind: 'number', min: 1, max: 6 }, { key: 'cardStyle', kind: 'select', options: ['shadow', 'border', 'flat', 'minimal'] },
    { key: 'showDescription', kind: 'toggle' }, { key: 'emptyText', kind: 'text' },
  ],
  course: [{ key: 'courseUuid', kind: 'course' }, { key: 'layout', kind: 'select', options: ['split', 'card'] }, { key: 'buttonLabel', kind: 'text' }, { key: 'showDescription', kind: 'toggle' }],
  paths: [{ key: 'source', kind: 'select', options: ['latest', 'selected'] }, { key: 'pathUuids', kind: 'paths' }, { key: 'limit', kind: 'number', min: 1, max: 24 }, { key: 'columns', kind: 'number', min: 1, max: 4 }, { key: 'cardStyle', kind: 'select', options: ['shadow', 'border', 'flat', 'minimal'] }],
  communities: [{ key: 'limit', kind: 'number', min: 1, max: 24 }, { key: 'columns', kind: 'number', min: 1, max: 4 }, { key: 'cardStyle', kind: 'select', options: ['shadow', 'border', 'flat', 'minimal'] }, { key: 'emptyText', kind: 'text' }],
  podcasts: [{ key: 'limit', kind: 'number', min: 1, max: 24 }, { key: 'columns', kind: 'number', min: 1, max: 4 }, { key: 'cardStyle', kind: 'select', options: ['shadow', 'border', 'flat', 'minimal'] }, { key: 'emptyText', kind: 'text' }],
  live_sessions: [{ key: 'limit', kind: 'number', min: 1, max: 12 }, { key: 'layout', kind: 'select', options: ['list', 'grid'] }, { key: 'emptyText', kind: 'text' }],
  instructors: [
    { key: 'layout', kind: 'select', options: ['cards', 'row'] }, { key: 'columns', kind: 'number', min: 1, max: 6 },
    items('people', 'name', [{ key: 'name', kind: 'text' }, { key: 'role', kind: 'text' }, { key: 'bio', kind: 'textarea' }, { key: 'image', kind: 'image' }], () => ({ name: '', role: '', bio: '', image: '' })),
  ],
  testimonials: [
    { key: 'layout', kind: 'select', options: ['grid', 'carousel', 'single'] }, { key: 'columns', kind: 'number', min: 1, max: 4 }, { key: 'cardStyle', kind: 'select', options: ['shadow', 'border', 'flat', 'minimal'] },
    items('items', 'author', [{ key: 'quote', kind: 'textarea' }, { key: 'author', kind: 'text' }, { key: 'role', kind: 'text' }, { key: 'image', kind: 'image' }, { key: 'rating', kind: 'number', min: 0, max: 5 }], () => ({ quote: '', author: '', role: '', image: '', rating: 5 })),
  ],
  pricing: [
    { key: 'columns', kind: 'number', min: 1, max: 4 },
    items('plans', 'name', [
      { key: 'offerUuid', kind: 'offer' }, { key: 'name', kind: 'text' }, { key: 'price', kind: 'text' }, { key: 'period', kind: 'text' }, { key: 'description', kind: 'textarea' },
      { key: 'features', kind: 'strings' }, { key: 'highlighted', kind: 'toggle' }, { key: 'badge', kind: 'text' }, { key: 'button', kind: 'link' },
    ], () => ({ name: '', price: '', period: '', description: '', features: [], highlighted: false, badge: '', button: { ...link } }), 8),
  ],
  faq: [{ key: 'layout', kind: 'select', options: ['accordion', 'list', 'two-columns'] }, items('items', 'question', [{ key: 'question', kind: 'text' }, { key: 'answer', kind: 'textarea' }], () => ({ question: '', answer: '' }))],
  stats: [{ key: 'layout', kind: 'select', options: ['row', 'cards'] }, items('items', 'value', [{ key: 'value', kind: 'text' }, { key: 'label', kind: 'text' }], () => ({ value: '', label: '' }), 12)],
  logos: [{ key: 'grayscale', kind: 'toggle' }, { key: 'size', kind: 'select', options: ['sm', 'md', 'lg'] }, items('items', 'alt', [{ key: 'src', kind: 'image' }, { key: 'alt', kind: 'text' }, { key: 'href', kind: 'url' }], () => ({ src: '', alt: '', href: '' }))],
  features: [
    { key: 'layout', kind: 'select', options: ['cards', 'plain', 'list'] }, { key: 'columns', kind: 'number', min: 1, max: 4 }, { key: 'cardStyle', kind: 'select', options: ['shadow', 'border', 'flat', 'minimal'] },
    items('items', 'title', [{ key: 'icon', kind: 'icon' }, { key: 'title', kind: 'text' }, { key: 'text', kind: 'textarea' }], () => ({ icon: 'Star', title: '', text: '' })),
  ],
  steps: [{ key: 'layout', kind: 'select', options: ['horizontal', 'vertical'] }, items('items', 'title', [{ key: 'title', kind: 'text' }, { key: 'text', kind: 'textarea' }], () => ({ title: '', text: '' }), 20)],
  gallery: [{ key: 'columns', kind: 'number', min: 1, max: 6 }, items('images', 'alt', [{ key: 'src', kind: 'image' }, { key: 'alt', kind: 'text' }], () => ({ src: '', alt: '' }))],
  countdown: [{ key: 'target', kind: 'datetime' }, { key: 'doneText', kind: 'text' }],
  newsletter: [{ key: 'newsletterSlug', kind: 'newsletter' }, { key: 'placeholder', kind: 'text' }, { key: 'buttonLabel', kind: 'text' }, { key: 'successText', kind: 'text' }, { key: 'layout', kind: 'select', options: ['inline', 'stacked'] }],
  form: [
    { key: 'submitLabel', kind: 'text' }, { key: 'successText', kind: 'text' },
    items('fields', 'label', [{ key: 'label', kind: 'text' }, { key: 'type', kind: 'select', options: ['text', 'email', 'textarea', 'tel', 'select', 'checkbox'] }, { key: 'required', kind: 'toggle' }, { key: 'placeholder', kind: 'text' }, { key: 'options', kind: 'strings' }], () => ({ key: `field_${Math.random().toString(36).slice(2, 7)}`, label: '', type: 'text', required: false, placeholder: '', options: [] }), 12),
  ],
  navbar: [
    { key: 'variant', kind: 'select', options: ['simple', 'centered', 'split'] }, { key: 'showLogo', kind: 'toggle' }, { key: 'logoText', kind: 'text' }, { key: 'sticky', kind: 'toggle' },
    items('links', 'label', [{ key: 'label', kind: 'text' }, { key: 'href', kind: 'url' }], () => ({ ...link }), 12), { key: 'cta', kind: 'link' },
  ],
  footer: [
    { key: 'variant', kind: 'select', options: ['simple', 'columns'] }, { key: 'showLogo', kind: 'toggle' }, { key: 'text', kind: 'textarea' }, { key: 'copyright', kind: 'text' },
    items('columns', 'title', [{ key: 'title', kind: 'text' }], () => ({ title: '', links: [] }), 6),
    items('social', 'network', [{ key: 'network', kind: 'select', options: ['instagram', 'x', 'linkedin', 'youtube', 'facebook', 'tiktok', 'github', 'discord'] }, { key: 'href', kind: 'url' }], () => ({ network: 'instagram', href: '' }), 8),
  ],
}
