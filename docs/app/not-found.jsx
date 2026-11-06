import Link from 'next/link'
import Search from '@/components/Search/Search'

export const metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
}

const POPULAR = [
  { href: '/getting-started/quickstart', title: 'Quickstart', text: 'Create your first course in a few minutes.' },
  { href: '/self-hosting', title: 'Self-hosting', text: 'Run LearnHouse on your own server.' },
  { href: '/developers', title: 'Developers', text: 'Build on the API, SDK and components.' },
  { href: '/reference', title: 'API Reference', text: 'Every endpoint with examples.' },
]

export default function NotFound() {
  return (
    <div className="lh-not-found">
      <p className="lh-not-found-code">404</p>
      <h1>This page doesn’t exist</h1>
      <p className="lh-not-found-lede">It may have moved when the docs were reorganized. Search for it, or start from one of these.</p>
      <Search className="lh-not-found-search" placeholder="Search the docs…" />
      <div className="lh-not-found-grid">
        {POPULAR.map((item) => (
          <Link key={item.href} href={item.href} className="lh-not-found-card">
            <span className="lh-not-found-card-title">{item.title}</span>
            <span className="lh-not-found-card-text">{item.text}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
