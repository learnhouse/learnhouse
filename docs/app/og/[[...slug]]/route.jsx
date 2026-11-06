import { ImageResponse } from 'next/og'
import { getBreadcrumbs, getPage, getPages } from '@/lib/source'

// Social preview for every docs page: section, title and description, in the
// docs' own neutral style. Generated at build time.
const size = { width: 1200, height: 630 }

export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return getPages().map((page) => ({ slug: page.slug }))
}

export async function GET(_req, { params }) {
  const { slug = [] } = await params
  const page = getPage(slug)
  const crumbs = page ? getBreadcrumbs(page.route) : []
  const section = crumbs.length > 1 ? crumbs[0].title : 'Documentation'
  const title = page?.route === '/' ? 'Run your academy. Build anything on top.' : (page?.title ?? 'LearnHouse Docs')
  const description = page?.description ?? ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#ffffff',
          backgroundImage: 'radial-gradient(circle, #e5e5e5 1.5px, transparent 1.5px)',
          backgroundSize: '28px 28px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: '#0a0a0a', letterSpacing: -1 }}>learnhouse</div>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 600, color: '#525252', background: '#f5f5f5', borderRadius: 10, padding: '4px 12px' }}>
            Docs
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, background: '#ffffff', padding: '8px 0' }}>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: '#a3a3a3' }}>
            {section}
          </div>
          <div style={{ display: 'flex', fontSize: 68, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2.5, color: '#0a0a0a', maxWidth: 1000 }}>
            {title}
          </div>
          {description && (
            <div style={{ display: 'flex', fontSize: 28, lineHeight: 1.4, color: '#525252', maxWidth: 980 }}>
              {description.length > 150 ? `${description.slice(0, 147)}…` : description}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', fontSize: 22, color: '#737373' }}>docs.learnhouse.app</div>
      </div>
    ),
    size,
  )
}
