import Link from 'next/link'
import { PencilSimple } from '@phosphor-icons/react/dist/ssr'
import Sidebar from '../Sidebar/Sidebar'
import TOC from '../TOC/TOC'
import PageActions from './PageActions'

function Breadcrumb({ crumbs }) {
  if (!crumbs || crumbs.length <= 1) return null
  return (
    <nav className="lh-breadcrumb" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={crumb.route} className="lh-breadcrumb-item">
            {i > 0 && <span className="lh-breadcrumb-sep">/</span>}
            {isLast ? (
              <span className="lh-breadcrumb-current">{crumb.title}</span>
            ) : (
              <Link href={crumb.route} className="lh-breadcrumb-link">
                {crumb.title}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function Pagination({ prev, next }) {
  if (!prev && !next) return null
  return (
    <div className="lh-pagination" data-pagefind-ignore="all">
      {prev ? (
        <Link href={prev.route} className="lh-pagination-link lh-pagination-prev">
          <span className="lh-pagination-label">Previous</span>
          <span className="lh-pagination-title">{prev.title}</span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link href={next.route} className="lh-pagination-link lh-pagination-next">
          <span className="lh-pagination-label">Next</span>
          <span className="lh-pagination-title">{next.title}</span>
        </Link>
      ) : (
        <div />
      )}
    </div>
  )
}

function CloudAd() {
  return (
    <a href="https://learnhouse.app" target="_blank" rel="noopener noreferrer" className="lh-cloud-card">
      <span className="lh-cloud-card-label">LearnHouse Cloud</span>
      <span className="lh-cloud-card-title">Skip the servers</span>
      <span className="lh-cloud-card-text">Managed hosting with updates and backups included.</span>
      <span className="lh-cloud-card-link">Start free →</span>
    </a>
  )
}

const formatDate = (value) =>
  new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * The docs page shell: sidebar, article (breadcrumb, actions, content,
 * last edited, previous/next) and the "On this page" rail. The home page is a
 * full-width landing page instead.
 */
export default function Wrapper({ route, tree, crumbs, prev, next, toc, file, lastModified, children }) {
  if (route === '/') {
    return (
      <div className="lh-home">
        <div className="lh-prose lh-home-prose">{children}</div>
      </div>
    )
  }

  return (
    <div className="lh-page">
      <Sidebar tree={tree} />
      <div className="lh-content-area">
        <article className="lh-article">
          <div className="lh-article-header" data-pagefind-ignore="all">
            <Breadcrumb crumbs={crumbs} />
            <div className="lh-article-actions">
              <PageActions route={route} />
              {file && (
                <a
                  href={`https://github.com/learnhouse/learnhouse/edit/dev/docs/content/${file}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lh-edit-github"
                >
                  <PencilSimple size={13} weight="bold" />
                  Edit
                </a>
              )}
            </div>
          </div>
          <div className="lh-prose">{children}</div>
          {lastModified && (
            <div className="lh-article-footer" data-pagefind-ignore="all">
              <div className="lh-last-edited">Last edited on {formatDate(lastModified)}</div>
            </div>
          )}
          <Pagination prev={prev} next={next} />
        </article>
        <aside className="lh-toc" data-pagefind-ignore="all">
          {toc?.length > 0 && <TOC headings={toc} />}
          <CloudAd />
        </aside>
      </div>
    </div>
  )
}
