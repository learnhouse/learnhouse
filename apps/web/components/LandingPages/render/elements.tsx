'use client'
/**
 * Element renderers that ship with the page (layout, text, media, content
 * blocks, navigation). Heavier blocks (live data, forms, markdown, custom
 * code, embeds) load on demand from their own chunks: see LandingRenderer.
 */
import React from 'react'
import { CaretDown, Check, List as ListIcon, Star, X } from '@phosphor-icons/react'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { countdownParts, resolveLandingVideo, safeHref } from './helpers'
import type { LandingNode } from '../model/types'
import { LANDING_ICONS } from './icons'
import { rootProps, useRender } from './context'
import { gridCols } from '../model/style'

export { gridCols }

export interface ElementProps {
  node: LandingNode
  children?: React.ReactNode
}

const RATIOS: Record<string, string> = {
  '1:2': '1fr 2fr',
  '2:1': '2fr 1fr',
  '1:3': '1fr 3fr',
  '3:1': '3fr 1fr',
  '2:3': '2fr 3fr',
  '3:2': '3fr 2fr',
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function arr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function Placeholder({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="lhp-ph" role="img" aria-label={label}>
      {children}
      <span>{label}</span>
    </div>
  )
}

/* ── layout ─────────────────────────────────────────────────────────────── */

export function SectionEl({ node, children }: ElementProps) {
  const { mode } = useRender()
  const tag = (['section', 'header', 'footer', 'div'].includes(node.props?.tag) ? node.props.tag : 'section') as 'section'
  const video = node.style?.base?.backgroundVideo
  const src = typeof video === 'string' && /^(https?:\/\/|\/(?!\/))/.test(video) ? video : null
  const Tag = tag
  return (
    <Tag {...rootProps(node, mode, 'lhp-section')} style={{ ...(rootProps(node, mode).style || {}), ...(src ? { isolation: 'isolate' as const } : {}) }}>
      {src && <video className="lhp-bgvideo" src={src} autoPlay={mode === 'public'} muted loop playsInline aria-hidden="true" />}
      {children}
    </Tag>
  )
}

export function ContainerEl({ node, children }: ElementProps) {
  const { mode } = useRender()
  const href = str(node.props?.href)
  const props = rootProps(node, mode, 'lhp-container')
  if (href) {
    return (
      <a {...props} href={safeHref(href)} style={{ ...(props.style || {}), color: 'inherit', textDecoration: 'none', display: 'block' }} {...(node.props?.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    )
  }
  const Tag = (['div', 'article', 'aside', 'nav'].includes(node.props?.tag) ? node.props.tag : 'div') as 'div'
  return <Tag {...props}>{children}</Tag>
}

export function ColumnsEl({ node, children }: ElementProps) {
  const { mode } = useRender()
  const count = Math.max(1, React.Children.count(children))
  const ratio = count === 2 ? RATIOS[node.props?.ratio] : undefined
  const props = rootProps(node, mode, 'lhp-cols')
  return (
    <div
      {...props}
      data-stack={['tablet', 'mobile', 'never'].includes(node.props?.stackAt) ? node.props.stackAt : 'mobile'}
      style={{ ...(props.style || {}), gridTemplateColumns: ratio || `repeat(${count}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  )
}

/* ── text ───────────────────────────────────────────────────────────────── */

function Editable({ node, field, as: Tag, className, ...rest }: { node: LandingNode; field: string; as: any; className?: string; [k: string]: any }) {
  const ctx = useRender()
  const ref = React.useRef<HTMLElement>(null)
  const editing = ctx.mode === 'canvas' && ctx.editingId === node.id
  const value = str(node.props?.[field])
  React.useEffect(() => {
    if (!editing || !ref.current) return
    const el = ref.current
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [editing])
  if (!editing) return <Tag className={className} {...rest}>{rest.children ?? value}</Tag>
  return (
    <Tag
      {...rest}
      ref={ref}
      className={className}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e: React.FocusEvent<HTMLElement>) => ctx.onTextCommit?.(node.id, field, e.currentTarget.innerText.replace(/\n+$/, ''))}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          ctx.onTextCancel?.()
        } else if (e.key === 'Enter' && (node.type !== 'text' || e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          e.currentTarget.blur()
        }
        e.stopPropagation()
      }}
      onPaste={(e: React.ClipboardEvent<HTMLElement>) => {
        e.preventDefault()
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
      }}
    >
      {value}
    </Tag>
  )
}

export function HeadingEl({ node }: ElementProps) {
  const { mode } = useRender()
  const level = Math.min(6, Math.max(1, Number(node.props?.level) || 2))
  const p = rootProps(node, mode, `lhp-h lhp-h${level}`)
  return <Editable node={node} field="text" as={`h${level}`} {...p} />
}

export function TextEl({ node }: ElementProps) {
  const { mode } = useRender()
  return <Editable node={node} field="text" as="p" {...rootProps(node, mode, 'lhp-text')} />
}

export function ButtonEl({ node }: ElementProps) {
  const { mode } = useRender()
  const p = node.props || {}
  const Icon = p.icon ? LANDING_ICONS[p.icon] : null
  const variant = ['primary', 'secondary', 'outline', 'ghost', 'link'].includes(p.variant) ? p.variant : 'primary'
  const size = ['sm', 'md', 'lg'].includes(p.size) ? p.size : 'md'
  const icon = Icon ? <Icon size={size === 'lg' ? 18 : 16} weight="bold" className={p.iconPosition === 'end' ? 'rtl:rotate-180' : undefined} aria-hidden /> : null
  const props = rootProps(node, mode, 'lhp-btn')
  return (
    <a
      {...props}
      href={safeHref(p.href)}
      data-variant={variant}
      data-size={size}
      data-full={p.fullWidth ? 'true' : undefined}
      {...(p.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {p.iconPosition !== 'end' && icon}
      <Editable node={node} field="label" as="span" />
      {p.iconPosition === 'end' && icon}
    </a>
  )
}

export function ListEl({ node }: ElementProps) {
  const { mode } = useRender()
  const marker = ['check', 'dot', 'number', 'none'].includes(node.props?.marker) ? node.props.marker : 'check'
  return (
    <ul {...rootProps(node, mode, 'lhp-list')} data-marker={marker}>
      {arr<string>(node.props?.items).map((item, i) => (
        <li key={i}>
          {marker === 'check' && <Check size={18} weight="bold" className="lhp-mark" aria-hidden />}
          {marker === 'dot' && <span className="lhp-mark" aria-hidden />}
          {marker === 'number' && <span className="lhp-mark">{i + 1}.</span>}
          <span>{str(item)}</span>
        </li>
      ))}
    </ul>
  )
}

/* ── media ──────────────────────────────────────────────────────────────── */

export function ImageEl({ node }: ElementProps) {
  const { mode, labels } = useRender()
  const p = node.props || {}
  const src = str(p.src)
  const [broken, setBroken] = React.useState<string | null>(null)
  // No image, or one that fails to load: a placeholder while editing, nothing for visitors.
  if (!src || broken === src) return mode === 'canvas' ? <div {...rootProps(node, mode)} style={{ width: '100%' }}><Placeholder label={labels.placeholder_image} /></div> : null
  // The node's style lives on the image itself; links and captions wrap it.
  let out: React.ReactElement = <img {...rootProps(node, mode, 'lhp-img')} src={src} alt={str(p.alt)} loading="lazy" decoding="async" onError={() => setBroken(src)} />
  if (p.href) out = <a href={safeHref(p.href)} style={{ display: 'block' }} {...(p.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{out}</a>
  if (p.caption) out = <figure className="lhp-figure">{out}<figcaption>{str(p.caption)}</figcaption></figure>
  return out
}

export function VideoEl({ node }: ElementProps) {
  const { mode, labels } = useRender()
  const p = node.props || {}
  const video = resolveLandingVideo(str(p.url))
  if (!video) return mode === 'canvas' ? <div {...rootProps(node, mode)} style={{ width: '100%' }}><Placeholder label={labels.placeholder_embed} /></div> : null
  return (
    <div {...rootProps(node, mode, 'lhp-video')}>
      {video.kind === 'embed' ? (
        <iframe src={video.src} title="Video" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
      ) : (
        <video
          src={video.src}
          poster={str(p.poster) || undefined}
          controls={p.controls !== false}
          autoPlay={!!p.autoplay && mode === 'public'}
          loop={!!p.loop}
          muted={!!p.muted || !!p.autoplay}
          playsInline
          preload="metadata"
        />
      )}
    </div>
  )
}

export function IconEl({ node }: ElementProps) {
  const { mode } = useRender()
  const Icon = LANDING_ICONS[node.props?.name] || Star
  const size = Math.min(160, Math.max(12, Number(node.props?.size) || 32))
  const weight = ['regular', 'bold', 'duotone', 'fill', 'light'].includes(node.props?.weight) ? node.props.weight : 'duotone'
  return (
    <span {...rootProps(node, mode)} style={{ display: 'inline-flex', ...(rootProps(node, mode).style || {}) }}>
      <Icon size={size} weight={weight} aria-hidden />
    </span>
  )
}

export function DividerEl({ node }: ElementProps) {
  const { mode } = useRender()
  return <hr {...rootProps(node, mode, 'lhp-divider')} />
}

export function SpacerEl({ node }: ElementProps) {
  const { mode } = useRender()
  const size = Math.min(400, Math.max(0, Number(node.props?.size) || 0))
  return <div {...rootProps(node, mode)} style={{ height: size, ...(mode === 'canvas' ? { background: 'repeating-linear-gradient(90deg,transparent,transparent 6px,rgba(59,130,246,.08) 6px,rgba(59,130,246,.08) 12px)' } : {}) }} aria-hidden="true" />
}

/* ── content blocks ─────────────────────────────────────────────────────── */

function cardStyle(v: unknown): string {
  return ['shadow', 'border', 'flat', 'minimal'].includes(v as string) ? (v as string) : 'shadow'
}

function gridVars(columns: unknown, fallback = 3, count = 0): React.CSSProperties {
  return { ['--lhp-cols' as any]: gridCols(columns, count, fallback) }
}

export function FeaturesEl({ node }: ElementProps) {
  const { mode } = useRender()
  const p = node.props || {}
  const layout = ['cards', 'plain', 'list'].includes(p.layout) ? p.layout : 'cards'
  const items = arr(p.items)
  const props = rootProps(node, mode, layout === 'list' ? 'lhp-list' : 'lhp-grid')
  return (
    <div {...props} style={{ ...(props.style || {}), ...(layout === 'list' ? { gap: 24 } : gridVars(p.columns, 3, items.length)) }}>
      {items.map((item, i) => {
        const Icon = item?.icon ? LANDING_ICONS[item.icon] : null
        const mark = Icon ? (
          <span className="lhp-icon-tile"><Icon size={24} weight="duotone" aria-hidden /></span>
        ) : item?.emoji ? (
          <span className="lhp-emoji" aria-hidden>{str(item.emoji)}</span>
        ) : null
        if (layout === 'list') {
          return (
            <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {mark}
              <div>
                <h3 className="lhp-card-title">{str(item?.title)}</h3>
                <p className="lhp-text" style={{ opacity: 0.75, marginTop: 4 }}>{str(item?.text)}</p>
              </div>
            </div>
          )
        }
        return (
          <div key={i} className="lhp-card" data-card={layout === 'plain' ? 'minimal' : cardStyle(p.cardStyle)}>
            <div className="lhp-card-body" style={{ gap: 10 }}>
              {mark && <div style={{ marginBottom: 6 }}>{mark}</div>}
              <h3 className="lhp-card-title">{str(item?.title)}</h3>
              <p className="lhp-card-text lhp-text">{str(item?.text)}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Stars({ n }: { n: number }) {
  if (!n) return null
  return (
    <div className="lhp-stars" aria-label={`${n}/5`}>
      {Array.from({ length: Math.min(5, n) }).map((_, i) => <Star key={i} size={16} weight="fill" aria-hidden />)}
    </div>
  )
}

function Avatar({ name, image, size = 44 }: { name: string; image?: string; size?: number }) {
  if (image) return <img className="lhp-avatar" src={image} alt="" style={{ width: size, height: size }} loading="lazy" />
  return <span className="lhp-avatar" style={{ width: size, height: size }} aria-hidden>{(name || '?').trim().charAt(0).toUpperCase()}</span>
}

export function TestimonialsEl({ node }: ElementProps) {
  const { mode } = useRender()
  const p = node.props || {}
  const items = arr(p.items)
  const layout = ['grid', 'carousel', 'single'].includes(p.layout) ? p.layout : 'grid'
  if (layout === 'single' && items[0]) {
    const t = items[0]
    return (
      <figure {...rootProps(node, mode)} style={{ textAlign: 'center', maxWidth: 820, marginInline: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, ...(rootProps(node, mode).style || {}) }}>
        <Stars n={Number(t.rating) || 0} />
        <blockquote style={{ fontFamily: 'var(--lhp-font-heading)', fontSize: 'clamp(1.35rem,2.6cqi,1.9rem)', lineHeight: 1.35, fontWeight: 500, margin: 0 }}>“{str(t.quote)}”</blockquote>
        <figcaption style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar name={str(t.author)} image={str(t.image)} />
          <div style={{ textAlign: 'start' }}>
            <div style={{ fontWeight: 600 }}>{str(t.author)}</div>
            {t.role && <div style={{ opacity: 0.65, fontSize: '.875rem' }}>{str(t.role)}</div>}
          </div>
        </figcaption>
      </figure>
    )
  }
  const props = rootProps(node, mode, layout === 'carousel' ? 'lhp-row' : 'lhp-grid')
  return (
    <div {...props} style={{ ...(props.style || {}), ...gridVars(p.columns, 3, items.length) }}>
      {items.map((t, i) => (
        <figure key={i} className="lhp-card" data-card={cardStyle(p.cardStyle)}>
          <div className="lhp-card-body" style={{ gap: 16 }}>
            <Stars n={Number(t?.rating) || 0} />
            <blockquote className="lhp-quote" style={{ margin: 0, flex: 1 }}>“{str(t?.quote)}”</blockquote>
            <figcaption style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={str(t?.author)} image={str(t?.image)} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '.9375rem' }}>{str(t?.author)}</div>
                {t?.role && <div className="lhp-card-text" style={{ fontSize: '.8125rem' }}>{str(t.role)}</div>}
              </div>
            </figcaption>
          </div>
        </figure>
      ))}
    </div>
  )
}

export function FaqEl({ node }: ElementProps) {
  const { mode } = useRender()
  const p = node.props || {}
  const items = arr(p.items)
  const layout = ['accordion', 'list', 'two-columns'].includes(p.layout) ? p.layout : 'accordion'
  if (layout !== 'accordion') {
    const props = rootProps(node, mode, layout === 'two-columns' ? 'lhp-grid' : 'lhp-faq')
    return (
      <div {...props} style={{ ...(props.style || {}), ...(layout === 'two-columns' ? gridVars(2, 2, items.length) : {}) }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h3 className="lhp-card-title">{str(it?.question)}</h3>
            <p className="lhp-text" style={{ opacity: 0.75 }}>{str(it?.answer)}</p>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div {...rootProps(node, mode, 'lhp-faq')}>
      {items.map((it, i) => (
        <details key={i} open={mode === 'canvas' && i === 0}>
          <summary>
            <span>{str(it?.question)}</span>
            <CaretDown size={18} className="lhp-caret" aria-hidden />
          </summary>
          <p className="lhp-answer">{str(it?.answer)}</p>
        </details>
      ))}
    </div>
  )
}

export function StatsEl({ node }: ElementProps) {
  const { mode } = useRender()
  const p = node.props || {}
  const cards = p.layout === 'cards'
  const props = rootProps(node, mode, cards ? 'lhp-grid' : 'lhp-stats')
  return (
    <dl {...props} style={{ ...(props.style || {}), ...(cards ? gridVars(Math.min(4, arr(p.items).length || 4)) : {}) }}>
      {arr(p.items).map((it, i) => (
        <div key={i} className={cards ? 'lhp-card lhp-stat' : 'lhp-stat'} data-card={cards ? 'shadow' : undefined} style={cards ? { padding: 24 } : undefined}>
          <dd className="lhp-stat-value" style={{ margin: 0 }}>{str(it?.value)}</dd>
          <dt className="lhp-stat-label">{str(it?.label)}</dt>
        </div>
      ))}
    </dl>
  )
}

export function LogosEl({ node }: ElementProps) {
  const { mode, labels } = useRender()
  const p = node.props || {}
  const items = arr(p.items).filter((l) => l?.src)
  const height = p.size === 'sm' ? 28 : p.size === 'lg' ? 64 : 40
  if (!items.length) return mode === 'canvas' ? <div {...rootProps(node, mode)} style={{ width: '100%' }}><Placeholder label={labels.placeholder_image} /></div> : null
  return (
    <div {...rootProps(node, mode, 'lhp-logos')} data-gray={p.grayscale ? 'true' : 'false'}>
      {items.map((l, i) => {
        const img = <img src={str(l.src)} alt={str(l.alt)} style={{ height }} loading="lazy" />
        return l.href ? <a key={i} href={safeHref(l.href)} target="_blank" rel="noopener noreferrer">{img}</a> : <React.Fragment key={i}>{img}</React.Fragment>
      })}
    </div>
  )
}

export function StepsEl({ node }: ElementProps) {
  const { mode } = useRender()
  const p = node.props || {}
  const items = arr(p.items)
  const props = rootProps(node, mode, 'lhp-steps')
  return (
    <ol {...props} data-layout={p.layout === 'vertical' ? 'vertical' : 'horizontal'} style={{ ...(props.style || {}), listStyle: 'none', padding: 0, ...gridVars(Math.min(4, items.length || 3)) }}>
      {items.map((it, i) => (
        <li key={i} className="lhp-step">
          <span className="lhp-step-n">{i + 1}</span>
          <div>
            <h3 className="lhp-card-title" style={{ marginTop: p.layout === 'vertical' ? 6 : 8 }}>{str(it?.title)}</h3>
            <p className="lhp-text" style={{ opacity: 0.72, marginTop: 4 }}>{str(it?.text)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function GalleryEl({ node }: ElementProps) {
  const { mode, labels } = useRender()
  const p = node.props || {}
  const images = arr(p.images).filter((im) => im?.src)
  if (!images.length) return mode === 'canvas' ? <div {...rootProps(node, mode)} style={{ width: '100%' }}><Placeholder label={labels.placeholder_image} /></div> : null
  const props = rootProps(node, mode, 'lhp-grid')
  return (
    <div {...props} style={{ ...(props.style || {}), ...gridVars(p.columns, 3, images.length) }}>
      {images.map((im, i) => (
        <img key={i} src={str(im.src)} alt={str(im.alt)} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 'var(--lhp-radius)', display: 'block' }} />
      ))}
    </div>
  )
}

export function CountdownEl({ node }: ElementProps) {
  const { mode, labels } = useRender()
  const [now, setNow] = React.useState<Date | null>(null)
  React.useEffect(() => {
    const tick = () => setNow(new Date())
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])
  const target = str(node.props?.target) || new Date(Date.now() + 7 * 86400000).toISOString()
  const parts = now ? countdownParts(target, now) : null
  if (parts?.done && node.props?.doneText) {
    return <p {...rootProps(node, mode)} style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', ...(rootProps(node, mode).style || {}) }}>{str(node.props.doneText)}</p>
  }
  const cells = parts ? [parts.days, parts.hours, parts.minutes, parts.seconds] : [0, 0, 0, 0]
  return (
    <div {...rootProps(node, mode, 'lhp-countdown')} aria-live="off">
      {cells.map((v, i) => (
        <div key={i}>
          <b>{parts ? String(v).padStart(2, '0') : '--'}</b>
          <span>{labels.countdown[i]}</span>
        </div>
      ))}
    </div>
  )
}

export function InstructorsEl({ node }: ElementProps) {
  const { mode } = useRender()
  const p = node.props || {}
  const people = arr(p.people)
  const row = p.layout === 'row'
  const props = rootProps(node, mode, row ? 'lhp-logos' : 'lhp-grid')
  return (
    <div {...props} style={{ ...(props.style || {}), ...(row ? { gap: '32px 64px', alignItems: 'flex-start' } : gridVars(p.columns, 4, people.length)) }}>
      {people.map((person, i) => {
        const inner = (
          <>
            <Avatar name={str(person?.name)} image={str(person?.image)} size={row ? 96 : 72} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', textAlign: 'center' }}>
              <h3 className="lhp-card-title">{str(person?.name)}</h3>
              {person?.role && <div className="lhp-card-text" style={{ fontSize: '.875rem' }}>{str(person.role)}</div>}
              {person?.bio && !row && <p className="lhp-card-text lhp-text" style={{ fontSize: '.875rem', marginTop: 6 }}>{str(person.bio)}</p>}
            </div>
          </>
        )
        if (row) return <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: 160 }}>{inner}</div>
        return (
          <div key={i} className="lhp-card" data-card="shadow">
            <div className="lhp-card-body" style={{ alignItems: 'center', gap: 14, paddingTop: 28, paddingBottom: 28 }}>{inner}</div>
          </div>
        )
      })}
    </div>
  )
}

/* ── navigation ─────────────────────────────────────────────────────────── */

function OrgLogo({ showLogo, text }: { showLogo: boolean; text: string }) {
  const { org, orgslug } = useRender()
  const [broken, setBroken] = React.useState(false)
  // A missing or unreachable logo file falls back to the org name.
  const logo = showLogo && org?.logo_image && !broken ? getOrgLogoMediaDirectory(org.org_uuid, org.logo_image) : null
  return (
    <a className="lhp-nav-logo" href="/" aria-label={org?.name || orgslug}>
      {logo ? <img src={logo} alt="" onError={() => setBroken(true)} /> : null}
      {(!logo || text) && <span>{text || org?.name || ''}</span>}
    </a>
  )
}

export function NavbarEl({ node }: ElementProps) {
  const { mode, labels } = useRender()
  const p = node.props || {}
  const [open, setOpen] = React.useState(false)
  const variant = ['simple', 'centered', 'split'].includes(p.variant) ? p.variant : 'simple'
  const links = arr(p.links)
  const props = rootProps(node, mode, 'lhp-nav')
  return (
    <nav {...props} data-variant={variant} data-open={open ? 'true' : 'false'} style={{ ...(props.style || {}), ...(p.sticky && mode === 'public' ? { position: 'sticky', top: 0, zIndex: 20 } : {}) }}>
      <OrgLogo showLogo={p.showLogo !== false} text={str(p.logoText)} />
      <div className="lhp-nav-links">
        {links.map((l, i) => <a key={i} href={safeHref(l?.href)}>{str(l?.label)}</a>)}
        {variant !== 'split' && p.cta?.label && <a className="lhp-btn" data-variant="primary" data-size="sm" href={safeHref(p.cta.href)} style={{ opacity: 1 }}>{str(p.cta.label)}</a>}
      </div>
      {variant === 'split' && p.cta?.label && <a className="lhp-btn" data-variant="primary" data-size="sm" href={safeHref(p.cta.href)}>{str(p.cta.label)}</a>}
      <button type="button" className="lhp-btn lhp-nav-toggle" data-variant="ghost" data-size="sm" aria-label={labels.menu} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <X size={20} /> : <ListIcon size={20} />}
      </button>
    </nav>
  )
}

const SOCIAL: Record<string, string> = {
  instagram: 'InstagramLogo', x: 'XLogo', linkedin: 'LinkedinLogo', youtube: 'YoutubeLogo', facebook: 'FacebookLogo', tiktok: 'TiktokLogo', github: 'GithubLogo', discord: 'DiscordLogo',
}

/** "{year}" and "{org}" in footer text become the current year and the org name. */
export function fillFooterTokens(text: string, orgName: string, year = new Date().getFullYear()): string {
  return text.replace(/\{year\}/g, String(year)).replace(/\{org\}/g, orgName).replace(/\s{2,}/g, ' ').trim()
}

export function FooterEl({ node }: ElementProps) {
  const { mode, org } = useRender()
  const p = node.props || {}
  const columns = arr(p.columns)
  const social = arr(p.social)
  return (
    <div {...rootProps(node, mode, 'lhp-footer')}>
      <div className="lhp-footer-top">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
          <OrgLogo showLogo={p.showLogo !== false} text="" />
          {p.text && <p className="lhp-text" style={{ opacity: 0.75 }}>{str(p.text)}</p>}
        </div>
        {columns.map((col, i) => (
          <div key={i} className="lhp-footer-col">
            <b>{str(col?.title)}</b>
            {arr(col?.links).map((l, j) => <a key={j} href={safeHref(l?.href)}>{str(l?.label)}</a>)}
          </div>
        ))}
      </div>
      {(p.copyright || social.length > 0) && (
        <div className="lhp-footer-bottom">
          <span>{fillFooterTokens(str(p.copyright), org?.name || '')}</span>
          <div className="lhp-social">
            {social.map((s, i) => {
              const Icon = LANDING_ICONS[SOCIAL[s?.network]]
              return Icon ? <a key={i} href={safeHref(s.href)} target="_blank" rel="noopener noreferrer" aria-label={s.network}><Icon size={20} weight="fill" /></a> : null
            })}
          </div>
        </div>
      )}
    </div>
  )
}
