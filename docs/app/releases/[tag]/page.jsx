import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr'
import { getLatestVersions, getRelease, getReleases } from '../../../lib/releases'
import ReleaseCard from '../_components/ReleaseCard'
import { formatDate, releaseTitle } from '../_components/format'

export const revalidate = 3600
export const dynamicParams = true

export async function generateStaticParams() {
  const { releases } = await getReleases()
  return releases.map((r) => ({ tag: r.tag }))
}

async function load(params) {
  const { tag } = await params
  return getRelease(decodeURIComponent(tag))
}

export async function generateMetadata({ params }) {
  const found = await load(params)
  if (!found) return { title: 'Release not found' }
  const r = found.release
  const title = releaseTitle(r)
  return {
    title,
    description: `Release notes for ${title}, released ${formatDate(r.date)}.`,
    alternates: { canonical: `/releases/${r.tag}` },
  }
}

function Neighbour({ release, dir }) {
  if (!release) return <span />
  return (
    <Link href={`/releases/${encodeURIComponent(release.tag)}`} className={`lhr-card lhr-neighbour is-${dir}`}>
      <span className="lhr-label">{dir === 'newer' ? 'Newer' : 'Older'}</span>
      <span className="lhr-neighbour-title">{releaseTitle(release)}</span>
      <span className="lhr-neighbour-date">{formatDate(release.date)}</span>
    </Link>
  )
}

export default async function ReleasePage({ params }) {
  const found = await load(params)
  if (!found) notFound()
  const { release, newer, older } = found
  const latest = await getLatestVersions()
  const isLatest = latest.app?.tag === release.tag || latest.cli?.tag === release.tag

  return (
    <div className="lhr-page lhr-page-detail">
      <Link href="/releases" className="lhr-back">
        <ArrowLeft size={12} weight="bold" /> All releases
      </Link>
      <header className="lhr-hero lhr-hero-detail">
        <p className="lhr-kicker">{release.kind === 'cli' ? 'CLI release' : 'App release'}</p>
        <h1 className="lhr-title">{releaseTitle(release)}</h1>
      </header>
      <div className="lhr-panel">
        <ReleaseCard release={release} isLatest={isLatest} collapse={false} linkTitle={false} />
      </div>
      <nav className="lhr-neighbours" aria-label="Other releases">
        <Neighbour release={newer} dir="newer" />
        <Neighbour release={older} dir="older" />
      </nav>
    </div>
  )
}
