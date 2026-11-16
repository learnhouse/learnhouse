'use client'
/**
 * Blocks that show the organization's live content: courses, a featured
 * course, paths, communities, podcasts, live sessions and pricing (store
 * offers). Loaded on demand, so a page without them never downloads this.
 */
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarBlank, Check } from '@phosphor-icons/react'
import { landingCoursesQuery } from './blockQueries'
import { getOrgPaths } from '@services/paths/paths'
import { getCommunities } from '@services/communities/communities'
import { getOrgPodcasts } from '@services/podcasts/podcasts'
import { getPublicOffers } from '@ee/services/payments/offers'
import { getLiveSessions } from '@ee/services/live_sessions/live_sessions'
import { getCommunityThumbnailMediaDirectory, getCourseThumbnailMediaDirectory, getPathThumbnailMediaDirectory, getPodcastThumbnailMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { resourcePath } from '@/lib/seo/paths'
import { formatCurrency } from '@/lib/format'
import { resolvePricingPlan, safeHref, type LandingOffer } from './helpers'
import type { LandingNode } from '../model/types'
import { rootProps, useRender } from './context'
import { arr, gridCols, str } from './elements'

const STALE = 60_000

function cardStyle(v: unknown): string {
  return ['shadow', 'border', 'flat', 'minimal'].includes(v as string) ? (v as string) : 'shadow'
}

function Skeleton({ count, columns }: { count: number; columns: number }) {
  return (
    <div className="lhp-grid" style={{ ['--lhp-cols' as any]: columns }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="lhp-card" data-card="flat" style={{ minHeight: 220, opacity: 0.6 }} />
      ))}
    </div>
  )
}

function Empty({ node, text, signIn = false }: { node: LandingNode; text: string; signIn?: boolean }) {
  const { mode, orgslug, labels } = useRender()
  const own = str(node.props?.emptyText)
  if (mode !== 'canvas' && !own) return null
  return (
    <div {...rootProps(node, mode)} style={{ width: '100%' }}>
      <div className="lhp-empty">
        <p>{own || text}</p>
        {/* Visitors only get public content: an empty list often means "sign in". */}
        {signIn && <a className="lhp-btn" data-variant="secondary" data-size="sm" href={getUriWithOrg(orgslug, '/login')}>{labels.sign_in}</a>}
      </div>
    </div>
  )
}

function Thumb({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = React.useState(false)
  if (src && !broken) return <img className="lhp-thumb" src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
  return <div className="lhp-thumb-ph" aria-hidden>{(name || '?').trim().charAt(0).toUpperCase()}</div>
}

interface CardItem {
  key: string
  title: string
  text: string
  image: string | null
  href: string
  meta?: string
}

function Cards({ node, items, columns, layout, more }: { node: LandingNode; items: CardItem[]; columns: number; layout: string; more: string }) {
  const { mode } = useRender()
  const style = cardStyle(node.props?.cardStyle)
  const showText = node.props?.showDescription !== false
  const cls = layout === 'carousel' ? 'lhp-row' : layout === 'list' ? 'lhp-faq' : 'lhp-grid'
  const props = rootProps(node, mode, cls)
  return (
    <div {...props} style={{ ...(props.style || {}), ['--lhp-cols' as any]: gridCols(columns, items.length) }}>
      {items.map((it) => (
        <a key={it.key} href={it.href} className="lhp-card" data-card={style} style={layout === 'list' ? { flexDirection: 'row', alignItems: 'stretch' } : undefined}>
          <div style={layout === 'list' ? { width: 'min(240px, 38%)', flex: 'none' } : undefined}>
            <Thumb src={it.image} name={it.title} />
          </div>
          <div className="lhp-card-body">
            {it.meta && <div className="lhp-card-text" style={{ fontSize: '.8125rem', fontWeight: 500 }}>{it.meta}</div>}
            <h3 className="lhp-card-title">{it.title}</h3>
            {showText && it.text && <p className="lhp-card-text lhp-clamp2">{it.text}</p>}
            <span className="lhp-more">{more} <ArrowRight size={14} weight="bold" className="rtl:rotate-180" aria-hidden /></span>
          </div>
        </a>
      ))}
    </div>
  )
}

function useCourses() {
  const { orgslug, accessToken } = useRender()
  return useQuery({
    ...landingCoursesQuery(orgslug, accessToken),
    enabled: !!orgslug,
  })
}

function courseItem(course: any, org: any, orgslug: string): CardItem {
  return {
    key: course.course_uuid,
    title: course.name || '',
    text: course.description || '',
    image: course.thumbnail_image && org?.org_uuid ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image) : null,
    href: getUriWithOrg(orgslug, resourcePath('course', course, course.course_uuid)),
  }
}

export function CoursesBlock({ node }: { node: LandingNode }) {
  const { org, orgslug, labels, mode, accessToken } = useRender()
  const p = node.props || {}
  const { data, isLoading } = useCourses()
  const columns = Math.min(6, Math.max(1, Number(p.columns) || 3))
  if (isLoading) return <div className={`lhp-${node.id}`}><Skeleton count={Math.min(columns, 4)} columns={columns} /></div>
  let list: any[] = data || []
  if (p.source === 'selected') {
    const order = arr<string>(p.courseUuids)
    list = order.map((uuid) => list.find((c) => c.course_uuid === uuid)).filter(Boolean)
  } else if (p.source === 'latest') {
    list = [...list].sort((a, b) => String(b.creation_date || '').localeCompare(String(a.creation_date || ''))).slice(0, Number(p.limit) || 6)
  }
  if (!list.length) return <Empty node={node} text={labels.courses_empty} signIn={mode === 'public' && !accessToken} />
  return <Cards node={node} items={list.map((c) => courseItem(c, org, orgslug))} columns={columns} layout={p.layout || 'grid'} more={labels.view_course} />
}

export function CourseBlock({ node }: { node: LandingNode }) {
  const { org, orgslug, labels, mode } = useRender()
  const p = node.props || {}
  const { data, isLoading } = useCourses()
  if (isLoading) return <div className={`lhp-${node.id}`}><Skeleton count={1} columns={1} /></div>
  // No course picked yet (a fresh section): the newest one, on the canvas and the live page.
  const course = (data || []).find((c: any) => c.course_uuid === p.courseUuid) || (!p.courseUuid ? (data || [])[0] : null)
  if (!course) return <Empty node={node} text={labels.placeholder_course} />
  const item = courseItem(course, org, orgslug)
  const split = p.layout !== 'card'
  return (
    <div {...rootProps(node, mode, 'lhp-card')} data-card="shadow" style={{ ...(rootProps(node, mode).style || {}), ...(split ? { flexDirection: 'row', flexWrap: 'wrap' } : {}) }}>
      <div style={split ? { flex: '1 1 340px', minWidth: 0 } : undefined}>
        <Thumb src={item.image} name={item.title} />
      </div>
      <div className="lhp-card-body" style={{ flex: '1 1 320px', justifyContent: 'center', gap: 14, padding: 'clamp(20px, 4cqi, 40px)' }}>
        <h3 className="lhp-h lhp-h3">{item.title}</h3>
        {p.showDescription !== false && item.text && <p className="lhp-card-text" style={{ fontSize: '1.0625rem' }}>{item.text}</p>}
        <div>
          <a className="lhp-btn" data-variant="primary" data-size="lg" href={item.href}>
            {str(p.buttonLabel) || labels.start_learning}
            <ArrowRight size={18} weight="bold" className="rtl:rotate-180" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  )
}

export function PathsBlock({ node }: { node: LandingNode }) {
  const { org, orgslug, accessToken, labels } = useRender()
  const p = node.props || {}
  const { data, isLoading } = useQuery({
    queryKey: ['landing-block', 'paths', org?.id, !!accessToken],
    queryFn: async () => {
      try {
        const res = await getOrgPaths(org.id, accessToken)
        return Array.isArray(res) ? res : []
      } catch {
        return []
      }
    },
    enabled: !!org?.id,
    staleTime: STALE,
  })
  const columns = Number(p.columns) || 3
  if (isLoading) return <div className={`lhp-${node.id}`}><Skeleton count={columns} columns={columns} /></div>
  let list: any[] = (data || []).filter((x: any) => x.published !== false)
  if (p.source === 'selected') list = arr<string>(p.pathUuids).map((u) => list.find((x) => x.path_uuid === u)).filter(Boolean)
  list = list.slice(0, Number(p.limit) || 3)
  if (!list.length) return <Empty node={node} text={labels.placeholder_data} />
  const items = list.map((x: any) => ({
    key: x.path_uuid,
    title: x.name,
    text: x.description,
    meta: x.course_count ? `${x.course_count} · ${labels.lessons}` : undefined,
    image: x.thumbnail_image && org?.org_uuid ? getPathThumbnailMediaDirectory(org.org_uuid, x.path_uuid, x.thumbnail_image) : null,
    href: getUriWithOrg(orgslug, resourcePath('path', x, x.path_uuid)),
  }))
  return <Cards node={node} items={items} columns={columns} layout="grid" more={labels.view_course} />
}

export function CommunitiesBlock({ node }: { node: LandingNode }) {
  const { org, orgslug, accessToken, labels } = useRender()
  const p = node.props || {}
  const limit = Number(p.limit) || 6
  const { data, isLoading } = useQuery({
    queryKey: ['landing-block', 'communities', org?.id, limit, !!accessToken],
    queryFn: async () => {
      try {
        const res = await getCommunities(org.id, 1, limit, null, accessToken)
        return Array.isArray(res) ? res : []
      } catch {
        return []
      }
    },
    enabled: !!org?.id,
    staleTime: STALE,
  })
  const columns = Number(p.columns) || 3
  if (isLoading) return <div className={`lhp-${node.id}`}><Skeleton count={columns} columns={columns} /></div>
  const list: any[] = (data || []).slice(0, limit)
  if (!list.length) return <Empty node={node} text={labels.placeholder_data} />
  const items = list.map((x: any) => ({
    key: x.community_uuid,
    title: x.name,
    text: x.description || '',
    image: x.thumbnail_image && org?.org_uuid ? getCommunityThumbnailMediaDirectory(org.org_uuid, x.community_uuid, x.thumbnail_image) : null,
    href: getUriWithOrg(orgslug, resourcePath('community', x, x.community_uuid)),
  }))
  return <Cards node={node} items={items} columns={columns} layout="grid" more={labels.view_course} />
}

export function PodcastsBlock({ node }: { node: LandingNode }) {
  const { org, orgslug, accessToken, labels } = useRender()
  const p = node.props || {}
  const { data, isLoading } = useQuery({
    queryKey: ['landing-block', 'podcasts', orgslug, !!accessToken],
    queryFn: async () => {
      try {
        const res = await getOrgPodcasts(orgslug, null, accessToken)
        return Array.isArray(res) ? res : []
      } catch {
        return []
      }
    },
    enabled: !!orgslug,
    staleTime: STALE,
  })
  const columns = Number(p.columns) || 3
  if (isLoading) return <div className={`lhp-${node.id}`}><Skeleton count={columns} columns={columns} /></div>
  const list: any[] = (data || []).filter((x: any) => x.published !== false).slice(0, Number(p.limit) || 6)
  if (!list.length) return <Empty node={node} text={labels.placeholder_data} />
  const items = list.map((x: any) => ({
    key: x.podcast_uuid,
    title: x.name,
    text: x.description || '',
    image: x.thumbnail_image && org?.org_uuid ? getPodcastThumbnailMediaDirectory(org.org_uuid, x.podcast_uuid, x.thumbnail_image) : null,
    href: getUriWithOrg(orgslug, resourcePath('podcast', x, x.podcast_uuid)),
  }))
  return <Cards node={node} items={items} columns={columns} layout="grid" more={labels.view_course} />
}

export function LiveSessionsBlock({ node }: { node: LandingNode }) {
  const { org, orgslug, accessToken, labels, mode } = useRender()
  const p = node.props || {}
  const limit = Number(p.limit) || 4
  const { data, isLoading } = useQuery({
    queryKey: ['landing-block', 'live', org?.id, limit, !!accessToken],
    queryFn: async () => {
      try {
        const res = await getLiveSessions(org.id, 'upcoming', accessToken, { limit })
        return Array.isArray(res) ? res : []
      } catch {
        return []
      }
    },
    enabled: !!org?.id,
    staleTime: STALE,
  })
  if (isLoading) return <div className={`lhp-${node.id}`}><Skeleton count={2} columns={2} /></div>
  const list: any[] = (data || []).slice(0, limit)
  if (!list.length) return <Empty node={node} text={labels.placeholder_data} />
  const grid = p.layout === 'grid'
  const props = rootProps(node, mode, grid ? 'lhp-grid' : 'lhp-faq')
  return (
    <div {...props} style={{ ...(props.style || {}), ['--lhp-cols' as any]: gridCols(2, list.length) }}>
      {list.map((s: any) => {
        const start = s.starts_at ? new Date(s.starts_at) : null
        return (
          <a key={s.live_session_uuid} className="lhp-card" data-card="border" href={getUriWithOrg(orgslug, `/live/${String(s.live_session_uuid).replace(/^livesession_/, '')}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 }}>
            <div className="lhp-icon-tile" style={{ flexDirection: 'column', width: 64, height: 64, gap: 0 }}>
              {start ? (
                <>
                  <span style={{ fontSize: '.6875rem', fontWeight: 600, textTransform: 'uppercase' }}>{start.toLocaleDateString(undefined, { month: 'short' })}</span>
                  <span style={{ fontSize: '1.375rem', fontWeight: 700, lineHeight: 1 }}>{start.getDate()}</span>
                </>
              ) : (
                <CalendarBlank size={24} />
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 className="lhp-card-title">{s.title}</h3>
              {start && <div className="lhp-card-text" style={{ fontSize: '.875rem' }}>{start.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}{s.duration_minutes ? ` · ${s.duration_minutes} min` : ''}</div>}
            </div>
            <ArrowRight size={16} className="rtl:rotate-180" style={{ opacity: 0.5, flex: 'none' }} aria-hidden />
          </a>
        )
      })}
    </div>
  )
}

export function PricingBlock({ node }: { node: LandingNode }) {
  const { org, labels, mode } = useRender()
  const p = node.props || {}
  const plans = arr(p.plans)
  const linked = plans.some((pl) => pl?.offerUuid)
  const { data: offers } = useQuery({
    queryKey: ['landing-block', 'offers', org?.id],
    queryFn: async (): Promise<LandingOffer[]> => {
      try {
        const res = await getPublicOffers(org.id)
        return res?.success && Array.isArray(res.data) ? res.data : []
      } catch {
        return []
      }
    },
    enabled: linked && !!org?.id,
    staleTime: STALE,
  })
  const lang = typeof document !== 'undefined' ? document.documentElement.lang || 'en' : 'en'
  const resolved = plans
    .map((pl) =>
      resolvePricingPlan(
        {
          name: str(pl?.name),
          price: str(pl?.price),
          period: str(pl?.period),
          description: str(pl?.description),
          features: arr<string>(pl?.features).join('\n'),
          highlighted: !!pl?.highlighted,
          button: { text: str(pl?.button?.label), link: str(pl?.button?.href), color: '', background: '' },
          offer_uuid: str(pl?.offerUuid) || undefined,
        },
        linked ? offers : [],
        (amount, currency) => formatCurrency(amount, currency, lang)
      )
    )
    .map((r, i) => (r ? { ...r, badge: str(plans[i]?.badge) } : null))
    .filter((r): r is NonNullable<typeof r> => r !== null)
  if (!resolved.length) return mode === 'canvas' ? <Empty node={node} text={labels.placeholder_data} /> : null
  const props = rootProps(node, mode, 'lhp-grid')
  return (
    <div {...props} style={{ ...(props.style || {}), ['--lhp-cols' as any]: gridCols(Math.min(4, Number(p.columns) || resolved.length), resolved.length), alignItems: 'stretch', maxWidth: `calc(${gridCols(Math.min(4, Number(p.columns) || resolved.length), resolved.length)} * 400px)`, marginInline: 'auto', width: '100%' }}>
      {resolved.map((plan, i) => (
        <div
          key={i}
          className="lhp-card"
          data-card="shadow"
          style={plan.highlighted ? { boxShadow: '0 0 0 2px var(--lhp-primary), 0 18px 40px -16px rgba(15,23,42,.3)' } : undefined}
        >
          <div className="lhp-card-body" style={{ gap: 14, padding: 'calc(28px * var(--lhp-density))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <h3 className="lhp-card-title" style={{ fontSize: '1.125rem' }}>{plan.name}</h3>
              {plan.badge && (
                <span style={{ fontSize: '.75rem', fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'color-mix(in srgb, var(--lhp-primary) 14%, transparent)', color: 'var(--lhp-primary)' }}>{plan.badge}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              {plan.priceIsMinimum && <span className="lhp-card-text">{labels.pricing_from}</span>}
              {plan.loading ? (
                <span style={{ height: 40, width: 110, borderRadius: 8, background: 'var(--lhp-surface)' }} aria-hidden />
              ) : (
                <span style={{ fontFamily: 'var(--lhp-font-heading)', fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1 }}>{plan.price}</span>
              )}
              {(plan.period || plan.subscription) && (
                <span className="lhp-card-text">
                  {plan.period || (plan.billingInterval === 'year' ? labels.pricing_year : plan.billingInterval === 'month' ? labels.pricing_month : labels.pricing_subscription)}
                </span>
              )}
            </div>
            {plan.description && <p className="lhp-card-text">{plan.description}</p>}
            <ul className="lhp-list" style={{ flex: 1, marginTop: 6 }}>
              {plan.features.map((f, j) => (
                <li key={j} style={{ fontSize: '.9375rem' }}>
                  <Check size={16} weight="bold" className="lhp-mark" aria-hidden />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {plan.button?.text && (
              <a className="lhp-btn" data-variant={plan.highlighted ? 'primary' : 'outline'} data-size="md" data-full="true" href={safeHref(plan.button.link)} style={{ marginTop: 10 }}>
                {plan.button.text}
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
