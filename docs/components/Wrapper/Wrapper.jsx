'use client'

import Sidebar from '../Sidebar/Sidebar'
import TOC from '../TOC/TOC'
import { useConfig } from 'nextra-theme-docs'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { PencilSimple } from '@phosphor-icons/react/dist/ssr'

function Breadcrumb() {
  const config = useConfig()
  const { activePath } = config.normalizePagesResult

  if (!activePath || activePath.length <= 1) return null

  // Nextra emits both a folder entry and its index page with the same route
  // (e.g. /developers/migration appears twice once you open /developers/migration).
  // Collapse consecutive duplicates so React keys stay unique and the trail
  // does not show the same crumb twice.
  const trail = activePath.filter((item, i, arr) => {
    const next = arr[i + 1]
    return !next || next.route !== item.route
  })

  return (
    <nav className="lh-breadcrumb" aria-label="breadcrumb">
      {trail.map((item, i) => {
        const isLast = i === trail.length - 1
        const title = typeof item.title === 'string' ? item.title : item.name
        return (
          <span key={`${item.route || ''}-${i}`} className="lh-breadcrumb-item">
            {i > 0 && <span className="lh-breadcrumb-sep">/</span>}
            {isLast ? (
              <span className="lh-breadcrumb-current">{title}</span>
            ) : (
              <Link href={item.route || '#'} className="lh-breadcrumb-link">
                {title}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function Pagination() {
  const config = useConfig()
  const { flatDocsDirectories, activeIndex } = config.normalizePagesResult

  const prev = activeIndex > 0 ? flatDocsDirectories[activeIndex - 1] : null
  const next = activeIndex < flatDocsDirectories.length - 1 ? flatDocsDirectories[activeIndex + 1] : null

  if (!prev && !next) return null

  return (
    <div className="lh-pagination">
      {prev ? (
        <Link href={prev.route} className="lh-pagination-link lh-pagination-prev">
          <span className="lh-pagination-label">Previous</span>
          <span className="lh-pagination-title">
            {typeof prev.title === 'string' ? prev.title : prev.name}
          </span>
        </Link>
      ) : <div />}
      {next ? (
        <Link href={next.route} className="lh-pagination-link lh-pagination-next">
          <span className="lh-pagination-label">Next</span>
          <span className="lh-pagination-title">
            {typeof next.title === 'string' ? next.title : next.name}
          </span>
        </Link>
      ) : <div />}
    </div>
  )
}

function EditOnGitHub({ filePath }) {
  // `filePath` comes from Nextra page metadata and is the actual source path
  // relative to the docs repo root (e.g. "content/cli/index.mdx"). Using it
  // directly avoids guessing folder-index vs leaf-file from the URL.
  if (!filePath) return null

  const href = `https://github.com/learnhouse/docs/edit/main/${filePath}`

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="lh-edit-github"
    >
      <PencilSimple size={13} weight="bold" />
      Edit on GitHub
    </a>
  )
}

function LastEdited({ timestamp }) {
  if (!timestamp) return null

  const date = new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="lh-last-edited">
      Last edited on {date}
    </div>
  )
}

function CloudAd() {
  return (
    <a
      href="https://learnhouse.app"
      target="_blank"
      rel="noopener noreferrer"
      className="group block nice-shadow rounded-2xl overflow-hidden bg-white! no-underline! relative transition-transform hover:scale-[1.02]"
    >
      {/* Dot pattern background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle, #a5b4fc 1px, transparent 1px)',
          backgroundSize: '14px 14px',
          maskImage: 'linear-gradient(to bottom, black 20%, transparent 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 20%, transparent 70%)',
        }}
      />

      <div className="relative p-4">
        <div className="flex items-center gap-2.5" style={{ marginBottom: 16 }}>
          <img src="/img/logos/learnhouse-dark.svg" alt="LearnHouse" className="h-3.5" />
          <span
            className="text-[8px] font-bold uppercase tracking-wide text-white! px-1.5 py-px rounded"
            style={{
              background: 'linear-gradient(180deg, #818cf8 0%, #6366f1 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 1px 3px rgba(99,102,241,0.4), 0 0.5px 0 rgba(99,102,241,0.2)',
              border: '0.5px solid rgba(99,102,241,0.5)',
              textShadow: '0 1px 1px rgba(0,0,0,0.15)',
            }}
          >
            Cloud
          </span>
        </div>
        <p className="text-[12px] font-semibold text-neutral-900! leading-snug m-0!">
          Try LearnHouse Cloud
        </p>
        <p className="mt-1.5 text-[10.5px] text-neutral-400! leading-relaxed m-0!">
          Managed hosting with automatic updates, backups, and scaling.
        </p>
        <div className="mt-3 inline-flex items-center gap-1 text-[10.5px] font-semibold text-indigo-500! group-hover:gap-2 transition-all">
          Get started free
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </div>
      </div>
    </a>
  )
}

export default function Wrapper({ children, toc, metadata }) {
  const pathname = usePathname()
  const isHome = pathname === '/'

  return (
    <div className="lh-page">
      <Sidebar />
      <div className="lh-content-area">
        <article className="lh-article">
          <div className="lh-article-header">
            <Breadcrumb />
            {!isHome && <EditOnGitHub filePath={metadata?.filePath} />}
          </div>
          <div className="lh-prose">
            {children}
          </div>
          {!isHome && (
            <div className="lh-article-footer">
              <LastEdited timestamp={metadata?.timestamp} />
            </div>
          )}
          <Pagination />
        </article>
        <div className="lh-toc">
          {toc && toc.length > 0 && (
            <TOC headings={toc} />
          )}
          <CloudAd />
        </div>
      </div>
    </div>
  )
}
