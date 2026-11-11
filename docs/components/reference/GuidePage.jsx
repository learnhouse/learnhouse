import Link from 'next/link'
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { GUIDES } from '../../lib/reference/config'
import { breadcrumbLd, jsonLdGraph, techArticleLd } from '../../lib/reference/seo'
import PageHeader from './PageHeader'
import JsonLd from './JsonLd'

/** Shell for /reference/guides/*: header, JSON-LD, on-page contents and prev/next. */
export default function GuidePage({ slug, title, lede, toc = [], children }) {
  const index = GUIDES.findIndex((g) => g.slug === slug)
  const prev = GUIDES[index - 1]
  const next = GUIDES[index + 1]
  const path = `/reference/guides/${slug}`
  const jsonLd = jsonLdGraph(
    techArticleLd({ title: `${title} | LearnHouse API`, description: lede, path, about: [title] }),
    breadcrumbLd([{ name: 'Guides', path: '/reference' }, { name: title, path }])
  )

  return (
    <div className="lhr-page lhr-guide">
      <JsonLd data={jsonLd} />
      <PageHeader crumbs={[{ name: 'Guides' }, { name: title }]} title={title} lede={lede} />
      <div className="lhr-guide-grid">
        <div className="lhr-guide-body">{children}</div>
        {toc.length > 0 && (
          <aside className="lhr-toc" aria-label="On this page">
            <p className="lhr-label">On this page</p>
            {toc.map((t) => (
              <a key={t.id} href={`#${t.id}`}>
                {t.title}
              </a>
            ))}
          </aside>
        )}
      </div>
      <nav className="lhr-pager" aria-label="Guides">
        {prev ? (
          <Link href={`/reference/guides/${prev.slug}`} className="lhr-card lhr-pager-link">
            <span className="lhr-label">
              <ArrowLeft size={11} weight="bold" /> Previous
            </span>
            <span className="lhr-card-title">{prev.title}</span>
          </Link>
        ) : (
          <Link href="/reference" className="lhr-card lhr-pager-link">
            <span className="lhr-label">
              <ArrowLeft size={11} weight="bold" /> Back
            </span>
            <span className="lhr-card-title">Overview</span>
          </Link>
        )}
        {next ? (
          <Link href={`/reference/guides/${next.slug}`} className="lhr-card lhr-pager-link lhr-pager-next">
            <span className="lhr-label">
              Next <ArrowRight size={11} weight="bold" />
            </span>
            <span className="lhr-card-title">{next.title}</span>
          </Link>
        ) : (
          <Link href="/reference/courses" className="lhr-card lhr-pager-link lhr-pager-next">
            <span className="lhr-label">
              Start with <ArrowRight size={11} weight="bold" />
            </span>
            <span className="lhr-card-title">Courses endpoints</span>
          </Link>
        )}
      </nav>
    </div>
  )
}

/** A guide section with an anchored h2. */
export function GuideSection({ id, title, children }) {
  return (
    <section className="lhr-gsection" aria-labelledby={id}>
      <h2 id={id} className="lhr-h2">
        <a href={`#${id}`} className="lhr-h-anchor">
          {title}
        </a>
      </h2>
      {children}
    </section>
  )
}
