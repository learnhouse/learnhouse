import Link from 'next/link'
import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr'
import { APP_IMAGE, GITHUB_RELEASES_URL } from '../../lib/releases/config'
import { getLatestVersions, getNpmPackages, getReleases } from '../../lib/releases'
import CurrentVersions from './_components/CurrentVersions'
import ReleaseCard from './_components/ReleaseCard'
import ReleaseFilter from './_components/ReleaseFilter'
import { formatDate, formatMonth, formatShortDate } from './_components/format'
import { socialMetadata } from '../../lib/seo'

export const revalidate = 3600

const DESCRIPTION =
  'Every LearnHouse and CLI release with notes, the current app, CLI and npm package versions, and how LearnHouse versioning works.'

export const metadata = {
  title: 'Releases',
  description: DESCRIPTION,
  alternates: { canonical: '/releases' },
  ...socialMetadata({ title: 'LearnHouse releases', description: DESCRIPTION, path: '/releases', image: '/og/releases' }),
}

function groupByMonth(releases) {
  const groups = []
  for (const r of releases) {
    const label = formatMonth(r.date)
    let g = groups[groups.length - 1]
    if (!g || g.label !== label) {
      g = { label, releases: [] }
      groups.push(g)
    }
    g.releases.push(r)
  }
  return groups
}

export default async function ReleasesPage() {
  const [{ releases, source, fetchedAt }, latest, npm] = await Promise.all([
    getReleases(),
    getLatestVersions(),
    getNpmPackages(),
  ])
  const latestTags = new Set([latest.app?.tag, latest.cli?.tag].filter(Boolean))
  const counts = {
    all: releases.length,
    app: releases.filter((r) => r.kind === 'app').length,
    cli: releases.filter((r) => r.kind === 'cli').length,
  }
  const groups = groupByMonth(releases)

  return (
    <div className="lhr-page">
      <header className="lhr-hero">
        <p className="lhr-kicker">Releases</p>
        <h1 className="lhr-title">What&rsquo;s new in LearnHouse</h1>
        <p className="lhr-lede">
          Every release of the LearnHouse app and CLI, with the notes published on GitHub, plus the
          current version of each package.
        </p>
      </header>

      <section className="lhr-panel" aria-labelledby="lhr-current">
        <h2 id="lhr-current" className="lhr-panel-title">
          Current versions
        </h2>
        <CurrentVersions latest={latest} npm={npm} />
      </section>

      <section className="lhr-panel" aria-labelledby="lhr-how">
        <h2 id="lhr-how" className="lhr-panel-title">
          How versions work
        </h2>
        <div className="lhr-howgrid">
          <div className="lhr-card lhr-how">
            <h3 className="lhr-how-title">One version for the app and packages</h3>
            <p>
              The app image <code className="lhr-code">{APP_IMAGE}:&lt;version&gt;</code> (also tagged{' '}
              <code className="lhr-code">latest</code>), <code className="lhr-code">@learnhouse/sdk</code> and{' '}
              <code className="lhr-code">@learnhouse/react</code> share one version number. Install the packages
              that match the instance you talk to.
            </p>
            <Link href="/developers/versioning" className="lhr-how-link">
              Versions &amp; Releases
            </Link>
          </div>
          <div className="lhr-card lhr-how">
            <h3 className="lhr-how-title">The CLI has its own versions</h3>
            <p>
              <code className="lhr-code">npx learnhouse</code> is released separately, with tags like{' '}
              <code className="lhr-code">cli-1.6.0</code>. Run a specific version with{' '}
              <code className="lhr-code">npx learnhouse@&lt;version&gt;</code>.
            </p>
            <Link href="/cli/commands" className="lhr-how-link">
              CLI commands
            </Link>
          </div>
          <div className="lhr-card lhr-how">
            <h3 className="lhr-how-title">LearnHouse Cloud</h3>
            <p>
              Cloud is updated continuously from development builds, so it can be ahead of the latest release.
              Use the latest packages with Cloud.
            </p>
          </div>
          <div className="lhr-card lhr-how">
            <h3 className="lhr-how-title">Updating a self-hosted instance</h3>
            <p>
              <code className="lhr-code">npx learnhouse update</code> backs up the database, pulls the new image
              and runs migrations before it starts. Add <code className="lhr-code">--to &lt;version&gt;</code> to
              pick a release.
            </p>
            <div className="lhr-how-links">
              <Link href="/self-hosting/maintenance/updates" className="lhr-how-link">
                Updates
              </Link>
              <Link href="/cli/commands#update" className="lhr-how-link">
                The update command
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="lhr-panel lhr-panel-timeline" aria-labelledby="lhr-timeline">
        <div className="lhr-panel-head">
          <h2 id="lhr-timeline" className="lhr-panel-title">
            Release timeline
          </h2>
          <a href={GITHUB_RELEASES_URL} className="lhr-panel-link" target="_blank" rel="noopener noreferrer">
            All releases on GitHub <ArrowUpRight size={12} weight="bold" />
          </a>
        </div>
        {source === 'snapshot' && (
          <p className="lhr-source">
            GitHub could not be reached, so this list comes from a saved copy
            {fetchedAt ? ` taken ${formatDate(fetchedAt)}` : ''}.
          </p>
        )}
        <ReleaseFilter counts={counts}>
          {groups.map((g) => (
            <section
              key={g.label}
              className="lhr-month"
              data-has-app={g.releases.some((r) => r.kind === 'app') || undefined}
              data-has-cli={g.releases.some((r) => r.kind === 'cli') || undefined}
            >
              <h3 className="lhr-month-label">{g.label}</h3>
              <ol className="lhr-month-list">
                {g.releases.map((r) => (
                  <li key={r.tag} className="lhr-row" data-kind={r.kind}>
                    <div className="lhr-rail" aria-hidden>
                      <span className="lhr-rail-date">{formatShortDate(r.date)}</span>
                      <span className="lhr-rail-dot" />
                    </div>
                    <ReleaseCard release={r} isLatest={latestTags.has(r.tag)} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </ReleaseFilter>
      </section>
    </div>
  )
}
