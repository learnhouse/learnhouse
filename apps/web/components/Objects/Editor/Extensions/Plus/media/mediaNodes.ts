/*
 The media and data nodes (EDITOR_PLUS_SPEC.md, section C): gallery,
 imageCompare, chart, statHighlights, fileCard (atoms) and quoteBlock
 (paragraphs inside).

 Every node's renderHTML is meaningful without JS or CSS (exports, copy,
 @tiptap/static-renderer): a gallery is a grid of figures, a comparison both
 images with their labels, a chart real SVG markup with a hidden data table,
 stats a definition list, a file card a link and a quote a figure around a
 blockquote. List-like attrs are stored as JSON in data-* attributes, so the
 HTML parses back to the same document.

 Node views follow blockImage: the atoms load on the client only (their
 code is a separate chunk); the quote's view is a lazy chunk too, with a
 fallback that draws its learner markup, so its text is in the server HTML.
*/
import { mergeAttributes, Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import dynamic from 'next/dynamic'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import type { PlusMode } from '../types'
import {
  chartSummary,
  chartSvg,
  chartTable,
  chartTypeOf,
  CHART_TYPES,
  DEFAULT_CHART_TEXT,
  isEmptyChart,
  layoutChart,
  normalizeChartData,
  seriesColor,
  type ChartText,
} from './chartModel'
import {
  blockObjectOf,
  clampPercent,
  COMPARE_ORIENTATIONS,
  fileTypeOf,
  fileTypeValue,
  formatFileSize,
  GALLERY_COLUMNS,
  GALLERY_LAYOUTS,
  normalizeCompareSide,
  normalizeGalleryImages,
  normalizeStats,
  oneOf,
  QUOTE_VARIANTS,
  safeUrl,
  STAT_COLUMNS,
} from './mediaModel'
import { lazyView } from '../lazyView'
import QuoteFallback from './views/QuoteFallback'

const GalleryView = dynamic(() => import('./views/GalleryView'), { ssr: false })
const ImageCompareView = dynamic(() => import('./views/ImageCompareView'), { ssr: false })
const ChartView = dynamic(() => import('./views/ChartView'), { ssr: false })
const StatHighlightsView = dynamic(() => import('./views/StatHighlightsView'), { ssr: false })
const FileCardView = dynamic(() => import('./views/FileCardView'), { ssr: false })
// The quote's text is content: its fallback draws the learner markup around it.
const QuoteBlockView = lazyView('QuoteBlockView', () => import('./views/QuoteBlockView'), QuoteFallback)

export interface MediaLabels {
  before: string
  after: string
  file: string
  fileTypes: Record<string, string>
  chart: ChartText
  locale?: string
}

export const DEFAULT_MEDIA_LABELS: MediaLabels = {
  before: 'Before',
  after: 'After',
  file: 'File',
  fileTypes: { pdf: 'PDF', doc: 'Document', sheet: 'Spreadsheet', slides: 'Slides', archive: 'Archive', image: 'Image', audio: 'Audio', video: 'Video', text: 'Text', code: 'Code', file: 'File' },
  chart: DEFAULT_CHART_TEXT,
}

export interface MediaNodesOptions {
  mode: PlusMode
  activity?: any
  labels?: () => MediaLabels
}

function enumAttr<T extends string | number>(name: string, html: string, allowed: readonly T[], fallback: T) {
  const read = (v: string | null): T => oneOf(allowed, typeof fallback === 'number' ? Number(v) : v, fallback)
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => read(el.getAttribute(`data-${html}`)),
    renderHTML: (attrs: Record<string, any>) => ({ [`data-${html}`]: String(oneOf(allowed, attrs[name], fallback)) }),
  }
}

function textAttr(name: string, html: string, fallback: string | null = null) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => el.getAttribute(`data-${html}`) ?? fallback,
    renderHTML: (attrs: Record<string, any>) => (attrs[name] ? { [`data-${html}`]: String(attrs[name]) } : {}),
  }
}

function boolAttr(name: string, html: string, fallback: boolean) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute(`data-${html}`)
      return v === null ? fallback : v === 'true'
    },
    renderHTML: (attrs: Record<string, any>) => ({ [`data-${html}`]: String(typeof attrs[name] === 'boolean' ? attrs[name] : fallback) }),
  }
}

/** A JSON value in a data-* attribute, cleaned with `normalize` when read. */
function jsonAttr<T>(name: string, html: string, fallback: T, normalize: (_v: unknown) => T) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => {
      const raw = el.getAttribute(`data-${html}`)
      if (raw === null) return fallback
      try {
        return normalize(JSON.parse(raw))
      } catch {
        return fallback
      }
    },
    renderHTML: (attrs: Record<string, any>) => ({ [`data-${html}`]: JSON.stringify(attrs[name] ?? fallback) }),
  }
}

function numberAttr(name: string, html: string, fallback: number | null) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => {
      const v = Number(el.getAttribute(`data-${html}`))
      return el.hasAttribute(`data-${html}`) && Number.isFinite(v) ? v : fallback
    },
    renderHTML: (attrs: Record<string, any>) => (typeof attrs[name] === 'number' && Number.isFinite(attrs[name]) ? { [`data-${html}`]: String(attrs[name]) } : {}),
  }
}

const imgSpec = (src: { url?: string | null; blockObject?: any }, alt: string): DOMOutputSpec => {
  const url = safeUrl(src.url)
  const block = blockObjectOf(src.blockObject)
  const attrs: Record<string, string> = { alt, loading: 'lazy' }
  if (url) attrs.src = url
  // Uploaded files need the org and course to build their URL; the node
  // views do that. Here the image keeps its alt text and a pointer.
  else if (block) attrs['data-block-uuid'] = block.block_uuid
  return ['img', attrs]
}

export function createMediaNodes({ mode, activity = null, labels = () => DEFAULT_MEDIA_LABELS }: MediaNodesOptions) {
  const options = () => ({ activity, mode })

  const Gallery = Node.create({
    name: 'gallery',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addOptions: options,
    addAttributes() {
      return {
        blockId: textAttr('blockId', 'block-id'),
        layout: enumAttr('layout', 'layout', GALLERY_LAYOUTS, 'grid'),
        columns: enumAttr('columns', 'columns', GALLERY_COLUMNS, 3),
        images: jsonAttr('images', 'images', [] as any[], normalizeGalleryImages),
      }
    },
    parseHTML() {
      return [{ tag: 'figure[data-type="gallery"]' }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const images = normalizeGalleryImages(node.attrs.images)
      const cols = oneOf(GALLERY_COLUMNS, node.attrs.columns, 3)
      const items = images.map((img): DOMOutputSpec => {
        const parts: DOMOutputSpec[] = [imgSpec(img, img.alt ?? '')]
        if (img.caption) parts.push(['figcaption', {}, img.caption])
        return ['figure', { class: 'lh-gallery-item' }, ...parts] as DOMOutputSpec
      })
      return ['figure', mergeAttributes(HTMLAttributes, { 'data-type': 'gallery', class: 'lh-gallery-static', style: `--lh-gallery-cols:${cols}` }), ['div', { class: 'lh-gallery-grid' }, ...items]] as DOMOutputSpec
    },
    addNodeView() {
      return lhNodeView(GalleryView as any)
    },
  })

  const ImageCompare = Node.create({
    name: 'imageCompare',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addOptions: options,
    addAttributes() {
      return {
        before: jsonAttr('before', 'before', { label: '' } as any, (v) => normalizeCompareSide(v)),
        after: jsonAttr('after', 'after', { label: '' } as any, (v) => normalizeCompareSide(v)),
        start: {
          default: 50,
          parseHTML: (el: HTMLElement) => clampPercent(el.getAttribute('data-start')),
          renderHTML: (attrs: Record<string, any>) => ({ 'data-start': String(clampPercent(attrs.start)) }),
        },
        orientation: enumAttr('orientation', 'orientation', COMPARE_ORIENTATIONS, 'horizontal'),
      }
    },
    parseHTML() {
      return [{ tag: 'figure[data-type="image-compare"]' }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const l = labels()
      const side = (key: 'before' | 'after'): DOMOutputSpec => {
        const s = normalizeCompareSide(node.attrs[key], key === 'before' ? l.before : l.after)
        return ['figure', { 'data-side': key }, imgSpec(s, s.alt ?? s.label), ['figcaption', {}, s.label]]
      }
      return ['figure', mergeAttributes(HTMLAttributes, { 'data-type': 'image-compare', class: 'lh-compare-static' }), side('before'), side('after')]
    },
    addNodeView() {
      return lhNodeView(ImageCompareView as any)
    },
  })

  const Chart = Node.create({
    name: 'chart',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addOptions: options,
    addAttributes() {
      return {
        type: enumAttr('type', 'chart-type', CHART_TYPES, 'column'),
        title: textAttr('title', 'title', ''),
        data: jsonAttr('data', 'chart', { labels: [], series: [] } as any, normalizeChartData),
        showLegend: boolAttr('showLegend', 'legend', true),
        showValues: boolAttr('showValues', 'values', false),
        stacked: boolAttr('stacked', 'stacked', false),
      }
    },
    parseHTML() {
      return [{ tag: 'figure[data-type="chart"]' }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const l = labels()
      const data = normalizeChartData(node.attrs.data)
      const type = chartTypeOf(node.attrs.type)
      const title = String(node.attrs.title || '').trim()
      const attrs = mergeAttributes(HTMLAttributes, { 'data-type': 'chart', class: 'lh-chart lh-chart-static' })
      const head: DOMOutputSpec[] = title ? [['figcaption', { class: 'lh-chart-title' }, title]] : []
      if (isEmptyChart(data)) return ['figure', attrs, ...head] as DOMOutputSpec
      const geometry = layoutChart(data, { type, stacked: node.attrs.stacked, showValues: node.attrs.showValues })
      const svg = chartSvg(geometry, {
        title: title || l.chart.fallbackTitle,
        desc: chartSummary(data, type, l.chart, l.locale),
        data,
        showValues: node.attrs.showValues,
        text: l.chart,
        locale: l.locale,
      })
      const parts: DOMOutputSpec[] = [...head, ['div', { class: 'lh-chart-canvas' }, svg as any]]
      if (node.attrs.showLegend !== false) {
        const entries = type === 'pie' || type === 'donut' ? data.labels.map((name, i) => ({ name, color: seriesColor(undefined, i) })) : data.series.map((s, i) => ({ name: s.name, color: seriesColor(s, i) }))
        parts.push(['ul', { class: 'lh-chart-legend' }, ...entries.map((e): DOMOutputSpec => ['li', {}, ['span', { class: 'lh-chart-swatch', style: `background:${e.color}`, 'aria-hidden': 'true' }], e.name])] as DOMOutputSpec)
      }
      parts.push(chartTable(data, title || l.chart.fallbackTitle, l.chart, l.locale) as any)
      return ['figure', attrs, ...parts] as DOMOutputSpec
    },
    addNodeView() {
      return lhNodeView(ChartView as any)
    },
  })

  const StatHighlights = Node.create({
    name: 'statHighlights',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addOptions: options,
    addAttributes() {
      return {
        items: jsonAttr('items', 'items', [] as any[], normalizeStats),
        columns: enumAttr('columns', 'columns', STAT_COLUMNS, 3),
        animate: boolAttr('animate', 'animate', true),
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-type="stat-highlights"]' }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const items = normalizeStats(node.attrs.items)
      const rows = items.map((s): DOMOutputSpec => {
        const parts: DOMOutputSpec[] = [['dt', {}, s.label], ['dd', { class: 'lh-stat-value' }, `${s.prefix ?? ''}${s.value}${s.suffix ?? ''}`]]
        if (s.description) parts.push(['dd', { class: 'lh-stat-desc' }, s.description])
        return ['div', s.tone ? { class: 'lh-stat', 'data-tone': s.tone } : { class: 'lh-stat' }, ...parts] as DOMOutputSpec
      })
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'stat-highlights', class: 'lh-stats-static' }), ['dl', {}, ...rows]] as DOMOutputSpec
    },
    addNodeView() {
      return lhNodeView(StatHighlightsView as any)
    },
  })

  const FileCard = Node.create({
    name: 'fileCard',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addOptions: options,
    addAttributes() {
      return {
        blockObject: jsonAttr('blockObject', 'block-object', null as any, blockObjectOf),
        url: {
          default: null,
          parseHTML: (el: HTMLElement) => safeUrl(el.getAttribute('data-url')),
          renderHTML: (attrs: Record<string, any>) => (safeUrl(attrs.url) ? { 'data-url': safeUrl(attrs.url)! } : {}),
        },
        name: textAttr('name', 'name', ''),
        description: textAttr('description', 'description'),
        sizeBytes: numberAttr('sizeBytes', 'size', null),
        fileType: {
          default: null,
          parseHTML: (el: HTMLElement) => fileTypeValue(el.getAttribute('data-file-type')),
          renderHTML: (attrs: Record<string, any>) => (fileTypeValue(attrs.fileType) ? { 'data-file-type': attrs.fileType } : {}),
        },
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-type="file-card"]' }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const l = labels()
      const { attrs } = node
      const name = String(attrs.name || '').trim() || l.file
      const type = fileTypeValue(attrs.fileType) ?? fileTypeOf(attrs.name || attrs.url || '')
      const meta = [l.fileTypes[type] ?? l.fileTypes.file, formatFileSize(attrs.sizeBytes, l.locale)].filter(Boolean).join(' · ')
      const href = safeUrl(attrs.url)
      const parts: DOMOutputSpec[] = [href ? ['a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'lh-file-name' }, name] : ['strong', { class: 'lh-file-name' }, name], ['span', { class: 'lh-file-meta' }, meta]]
      if (attrs.description) parts.push(['p', { class: 'lh-file-desc' }, String(attrs.description)])
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'file-card', class: 'lh-file-card-static' }), ...parts] as DOMOutputSpec
    },
    addNodeView() {
      return lhNodeView(FileCardView as any)
    },
  })

  const QuoteBlock = Node.create({
    name: 'quoteBlock',
    group: 'block',
    content: 'paragraph+',
    defining: true,
    draggable: true,
    addOptions: options,
    addAttributes() {
      return {
        variant: enumAttr('variant', 'variant', QUOTE_VARIANTS, 'pull'),
        author: textAttr('author', 'author'),
        role: textAttr('role', 'role'),
        avatarUrl: {
          default: null,
          parseHTML: (el: HTMLElement) => safeUrl(el.getAttribute('data-avatar')),
          renderHTML: (attrs: Record<string, any>) => (safeUrl(attrs.avatarUrl) ? { 'data-avatar': safeUrl(attrs.avatarUrl)! } : {}),
        },
      }
    },
    parseHTML() {
      return [{ tag: 'figure[data-type="quote-block"]', contentElement: 'blockquote' }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const author = String(node.attrs.author || '').trim()
      const role = String(node.attrs.role || '').trim()
      const avatar = safeUrl(node.attrs.avatarUrl)
      const attrs = mergeAttributes(HTMLAttributes, { 'data-type': 'quote-block', class: 'lh-quote-static' })
      const quote: DOMOutputSpec = ['blockquote', {}, 0]
      if (!author && !role) return ['figure', attrs, quote]
      const caption: any[] = []
      if (avatar) caption.push(['img', { src: avatar, alt: '', class: 'lh-quote-avatar' }])
      if (author) caption.push(['cite', {}, author])
      if (author && role) caption.push(', ')
      if (role) caption.push(['span', { class: 'lh-quote-role' }, role])
      return ['figure', attrs, quote, ['figcaption', {}, ...caption]] as DOMOutputSpec
    },
    addNodeView() {
      return lhNodeView(QuoteBlockView)
    },
  })

  return [Gallery, ImageCompare, Chart, StatHighlights, FileCard, QuoteBlock]
}

export const MEDIA_NODE_NAMES = ['gallery', 'imageCompare', 'chart', 'statHighlights', 'fileCard', 'quoteBlock'] as const
