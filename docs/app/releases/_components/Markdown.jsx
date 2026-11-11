import { GITHUB_REPO_URL } from '../../../lib/releases/config'

/*
 * Renders the JSON tree from lib/releases/markdown.js. Every string goes
 * through React as a text child, so release bodies are always escaped; only
 * http(s) URLs ever become hrefs.
 */

const SAFE_URL = /^https?:\/\//i

export function Inline({ nodes }) {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.v
      case 'br':
        return <br key={i} />
      case 'code':
        return (
          <code key={i} className="lhr-code">
            {n.v}
          </code>
        )
      case 'commit':
        return <CommitLink key={i} hash={n.v} />
      case 'strong':
        return (
          <strong key={i}>
            <Inline nodes={n.c} />
          </strong>
        )
      case 'link':
        return SAFE_URL.test(n.href) ? (
          <a key={i} href={n.href} className="lhr-link" target="_blank" rel="noopener noreferrer">
            {n.v}
          </a>
        ) : (
          n.v
        )
      case 'ref':
        return (
          <a key={i} href={`${GITHUB_REPO_URL}/pull/${n.n}`} className="lhr-link" target="_blank" rel="noopener noreferrer">
            #{n.n}
          </a>
        )
      case 'user':
        return (
          <a key={i} href={`https://github.com/${n.v}`} className="lhr-link" target="_blank" rel="noopener noreferrer">
            @{n.v}
          </a>
        )
      default:
        return null
    }
  })
}

export function CommitLink({ hash }) {
  return (
    <a
      href={`${GITHUB_REPO_URL}/commit/${hash}`}
      className="lhr-commit"
      target="_blank"
      rel="noopener noreferrer"
      title={`Commit ${hash}`}
    >
      {hash.length > 12 ? hash.slice(0, 8) : hash}
    </a>
  )
}

const MERGE_RE = /^merge (pull request|branch)\b/i

function itemIsMerge(item) {
  const first = item.c[0]
  return first?.t === 'text' && MERGE_RE.test(first.v)
}

export function Blocks({ blocks }) {
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'heading':
        return (
          <p key={i} className={b.level <= 1 ? 'lhr-md-h1' : 'lhr-md-h'}>
            <Inline nodes={b.c} />
          </p>
        )
      case 'para':
        return (
          <p key={i} className="lhr-md-p">
            <Inline nodes={b.c} />
          </p>
        )
      case 'list':
        return (
          <ul key={i} className="lhr-list">
            {b.items.map((item, j) => (
              <li key={j} className={itemIsMerge(item) ? 'lhr-item lhr-item-merge' : 'lhr-item'}>
                <span className="lhr-item-text">
                  <Inline nodes={item.c} />
                </span>
                {item.commit && <CommitLink hash={item.commit} />}
              </li>
            ))}
          </ul>
        )
      case 'code':
        return (
          <pre key={i} className="lhr-pre">
            <code>{b.text}</code>
          </pre>
        )
      case 'quote':
        return (
          <blockquote key={i} className="lhr-quote">
            <Blocks blocks={b.blocks} />
          </blockquote>
        )
      default:
        return null
    }
  })
}
