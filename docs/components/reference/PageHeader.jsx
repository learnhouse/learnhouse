import Link from 'next/link'
import { CaretRight } from '@phosphor-icons/react/dist/ssr'

/**
 * Header for every reference page: breadcrumb, title, lede and an optional
 * meta row, over a faded neutral pattern.
 */
export default function PageHeader({ crumbs = [], title, lede, pattern = 'grid', children }) {
  return (
    <header className={`lhr-head lhr-head-${pattern}`}>
      <nav className="lhr-crumbs" aria-label="Breadcrumb">
        <Link href="/reference">API Reference</Link>
        {crumbs.map((c) => (
          <span key={c.name} className="lhr-crumb">
            <CaretRight size={10} weight="bold" aria-hidden="true" />
            {c.href ? <Link href={c.href}>{c.name}</Link> : <span>{c.name}</span>}
          </span>
        ))}
      </nav>
      <h1 className="lhr-title">{title}</h1>
      {lede && <p className="lhr-lede">{lede}</p>}
      {children}
    </header>
  )
}
