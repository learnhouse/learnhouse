import Link from 'next/link'
import { ArrowUpRight, GithubLogo, Warning } from '@phosphor-icons/react/dist/ssr'
import { COLLAPSE_MIN_HIDDEN, COLLAPSE_VISIBLE_ITEMS, GITHUB_REPO_URL } from '../../../lib/releases/config'
import { Blocks } from './Markdown'
import MoreChanges from './MoreChanges'
import { formatDate, plural, releaseCommand } from './format'

/** Rows a block occupies when deciding where to collapse. */
const rowsOf = (b) => (b.type === 'list' ? b.items.length : 1)

/**
 * Split intro + sections into a visible head and a hidden tail after `budget`
 * rows. A list cut in half continues in the tail without repeating its label.
 */
function splitNotes(intro, sections, budget) {
  const parts = [{ label: null, blocks: intro }, ...sections.map((s) => ({ label: s.label, blocks: s.blocks }))]
  const totalRows = parts.reduce((n, p) => n + p.blocks.reduce((m, b) => m + rowsOf(b), 0), 0)
  if (totalRows - budget < COLLAPSE_MIN_HIDDEN) return { head: parts, tail: [] }

  const head = []
  const tail = []
  let left = budget
  for (const part of parts) {
    if (left <= 0) {
      tail.push(part)
      continue
    }
    const headBlocks = []
    const tailBlocks = []
    for (const b of part.blocks) {
      if (left <= 0) tailBlocks.push(b)
      else if (b.type === 'list' && b.items.length > left) {
        headBlocks.push({ ...b, items: b.items.slice(0, left) })
        tailBlocks.push({ ...b, items: b.items.slice(left) })
        left = 0
      } else {
        headBlocks.push(b)
        left -= rowsOf(b)
      }
    }
    if (headBlocks.length) head.push({ ...part, blocks: headBlocks })
    if (tailBlocks.length) tail.push({ ...part, label: headBlocks.length ? null : part.label, blocks: tailBlocks })
  }
  return { head, tail }
}

function Parts({ parts }) {
  return parts.map((p, i) =>
    p.label ? (
      <section key={i} className="lhr-notes-section">
        <h4 className="lhr-label">{p.label}</h4>
        <Blocks blocks={p.blocks} />
      </section>
    ) : p.blocks.length ? (
      <div key={i} className="lhr-notes-section lhr-notes-cont">
        <Blocks blocks={p.blocks} />
      </div>
    ) : null
  )
}

function Alert({ alert }) {
  return (
    <div className="lhr-alert" role="note">
      <Warning size={16} weight="fill" className="lhr-alert-icon" aria-hidden />
      <div className="lhr-alert-body">
        <Blocks blocks={alert.blocks} />
      </div>
    </div>
  )
}

export default function ReleaseCard({ release: r, isLatest = false, collapse = true, linkTitle = true }) {
  const { head, tail } = collapse
    ? splitNotes(r.intro, r.sections, COLLAPSE_VISIBLE_ITEMS)
    : { head: [{ label: null, blocks: r.intro }, ...r.sections], tail: [] }
  const hasNotes = r.intro.length > 0 || r.sections.length > 0
  // The intro (e.g. a "### 2FA, Students Analytics" tagline) sits above any alerts.
  const headIntro = head[0] && head[0].label === null && head[0].blocks.length ? [head[0]] : []
  const headRest = headIntro.length ? head.slice(1) : head
  const moreLabel = r.counts.total > 0 ? `Show all ${r.counts.total} changes` : 'Show full notes'

  const stats = []
  if (r.counts.features) stats.push(plural(r.counts.features, 'feature'))
  if (r.counts.fixes) stats.push(plural(r.counts.fixes, 'fix', 'fixes'))
  const other = r.counts.total - r.counts.features - r.counts.fixes
  if (other > 0) stats.push(stats.length ? `${other} other` : plural(other, 'change'))

  const title = (
    <>
      <span className="lhr-version-kind">{r.kind === 'cli' ? 'CLI' : 'App'}</span>
      <span className="lhr-version-num">{r.version}</span>
    </>
  )

  return (
    <article className="lhr-card lhr-release" id={r.tag} data-kind={r.kind}>
      <header className="lhr-release-head">
        <div className="lhr-release-titlerow">
          <h3 className="lhr-release-title">
            {linkTitle ? (
              <Link href={`/releases/${encodeURIComponent(r.tag)}`} className="lhr-release-titlelink">
                {title}
              </Link>
            ) : (
              title
            )}
          </h3>
          {isLatest && <span className="lhr-badge lhr-badge-dark">Latest</span>}
          {r.prerelease && <span className="lhr-badge">Pre-release</span>}
          <a href={r.url} className="lhr-iconlink" target="_blank" rel="noopener noreferrer" aria-label={`${r.name} on GitHub`}>
            <GithubLogo size={16} weight="fill" />
          </a>
        </div>
        <p className="lhr-release-meta">
          <time dateTime={r.date || undefined}>{formatDate(r.date)}</time>
          {stats.map((s) => (
            <span key={s} className="lhr-release-stat">
              {s}
            </span>
          ))}
        </p>
      </header>

      {headIntro.length > 0 && (
        <div className="lhr-notes">
          <Parts parts={headIntro} />
        </div>
      )}

      {r.alerts.length > 0 && (
        <div className="lhr-alerts">
          {r.alerts.map((a, i) => (
            <Alert key={i} alert={a} />
          ))}
        </div>
      )}

      {!hasNotes ? (
        <p className="lhr-empty">No notes were published for this release.</p>
      ) : headRest.length > 0 || tail.length > 0 ? (
        <div className="lhr-notes">
          <Parts parts={headRest} />
          {tail.length > 0 && (
            <MoreChanges label={moreLabel}>
              <Parts parts={tail} />
            </MoreChanges>
          )}
        </div>
      ) : null}

      {(r.contributors.length > 0 || r.newContributors.length > 0) && (
        <div className="lhr-contributors">
          <span className="lhr-label">Contributors</span>
          <ul className="lhr-people">
            {r.contributors.map((h) => (
              <li key={h}>
                <a href={`https://github.com/${h}`} target="_blank" rel="noopener noreferrer" className="lhr-person">
                  @{h}
                  {r.newContributors.some((n) => n.toLowerCase() === h.toLowerCase()) && (
                    <span className="lhr-person-new">first contribution</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="lhr-release-foot">
        <code className="lhr-cmd">{releaseCommand(r)}</code>
        <div className="lhr-release-links">
          {r.pr && (
            <a href={`${GITHUB_REPO_URL}/pull/${r.pr}`} target="_blank" rel="noopener noreferrer" className="lhr-footlink">
              PR #{r.pr}
            </a>
          )}
          {r.compareUrl && /^https?:\/\//.test(r.compareUrl) && (
            <a href={r.compareUrl} target="_blank" rel="noopener noreferrer" className="lhr-footlink">
              Full changelog
            </a>
          )}
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="lhr-footlink">
            GitHub release <ArrowUpRight size={12} weight="bold" />
          </a>
        </div>
      </div>
    </article>
  )
}

