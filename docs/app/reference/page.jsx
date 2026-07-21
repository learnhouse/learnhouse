import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { API_BASE_URL } from '../../lib/reference/config'
import { getSpec } from '../../lib/reference/fetch-spec'
import { buildGroupDirectory, validationErrorFields } from '../../lib/reference/build-model'
import { buildSnippets } from '../../lib/reference/snippets'
import { highlight } from '../../lib/reference/highlight'
import TokenWidget from '../../components/reference/TokenWidget'
import CodePanel from '../../components/reference/CodePanel'
import SchemaFields from '../../components/reference/SchemaFields'

export const revalidate = 3600

export const metadata = {
  title: 'API Reference',
  description:
    'Complete reference for the LearnHouse REST API — endpoints, request and response schemas, code examples and a live playground.',
  alternates: { canonical: '/reference' },
}

const ERROR_STATUSES = [
  ['401', 'Missing or invalid credentials.'],
  ['403', 'Authenticated, but not allowed to perform this action.'],
  ['404', 'The requested resource does not exist.'],
  ['409', 'The request conflicts with existing state (e.g. duplicate resource).'],
  ['422', 'Request validation failed — see the error format below.'],
  ['429', 'Rate limit exceeded — retry later.'],
]

export default async function ReferenceOverviewPage() {
  const spec = await getSpec()
  const directory = buildGroupDirectory(spec)
  const totalOps = directory.reduce((sum, g) => sum + g.count, 0)
  const errorFields = validationErrorFields(spec)

  const exampleRaw = buildSnippets({
    method: 'GET',
    url: `${API_BASE_URL}/api/v1/users/profile`,
    auth: true,
  })
  const exampleSnippets = {
    curl: { raw: exampleRaw.curl, html: await highlight(exampleRaw.curl, 'bash') },
    js: { raw: exampleRaw.js, html: await highlight(exampleRaw.js, 'javascript') },
    python: { raw: exampleRaw.python, html: await highlight(exampleRaw.python, 'python') },
  }

  return (
    <div className="lh-ref-overview">
      <header className="lh-ref-overview-head">
        <p className="lh-ref-overview-kicker">API Reference</p>
        <h1 className="lh-ref-overview-title">The LearnHouse API</h1>
        <p className="lh-ref-overview-lede">
          A REST API for driving LearnHouse programmatically — {totalOps} documented endpoints
          across courses, learners, assignments, payments and more. This reference is generated
          directly from the live OpenAPI specification, so it is always in sync with the API.
        </p>
      </header>

      <div className="lh-ref-op-grid">
        <div className="lh-ref-op-prose">
          <section className="lh-ref-section">
            <h2 className="lh-ref-overview-h2">Base URL</h2>
            <p className="lh-ref-op-desc">
              All endpoints live under <code>/api/v1</code>. Self-hosted instances substitute
              their own domain.
            </p>
            <pre className="lh-ref-baseurl">
              {API_BASE_URL}/api/v1
            </pre>
          </section>

          <section className="lh-ref-section">
            <h2 className="lh-ref-overview-h2">Authentication</h2>
            <p className="lh-ref-op-desc">
              Programmatic access uses organization API tokens, prefixed <code>lh_</code>. Create
              them in your dashboard under <strong>Developers → API Access</strong> (Pro plan) —
              the full token is shown once, at creation, and can be scoped to least-privilege
              rights. Send it as a bearer token on every request:
            </p>
            <pre className="lh-ref-baseurl">Authorization: Bearer lh_…</pre>
            <p className="lh-ref-op-desc">
              User-context flows can instead use the JWT returned by{' '}
              <Link href="/reference/auth">the login endpoint</Link> (form-encoded, not JSON) as
              the bearer token. See the{' '}
              <Link href="/developers/api/authentication">authentication guide</Link> for details.
            </p>
          </section>

          <section className="lh-ref-section">
            <h2 className="lh-ref-overview-h2">Errors</h2>
            <p className="lh-ref-op-desc">
              Errors return conventional HTTP status codes with a JSON body of the form{' '}
              <code>{'{ "detail": "…" }'}</code>. Validation failures return <code>422</code>{' '}
              with the structure below.
            </p>
            <div className="lh-ref-statustable">
              {ERROR_STATUSES.map(([status, description]) => (
                <div key={status} className="lh-ref-statustable-row">
                  <code className="lh-ref-errors-status">{status}</code>
                  <span>{description}</span>
                </div>
              ))}
            </div>
            {errorFields.length > 0 && (
              <details className="lh-ref-errors">
                <summary>422 validation error format</summary>
                <SchemaFields fields={errorFields} />
              </details>
            )}
          </section>

          <section className="lh-ref-section">
            <h2 className="lh-ref-overview-h2">Pagination</h2>
            <p className="lh-ref-op-desc">
              List endpoints paginate with <code>page</code> and <code>limit</code> parameters —
              as query parameters or path segments (e.g.{' '}
              <code>/courses/org_slug/{'{org_slug}'}/page/1/limit/20</code>), depending on the
              endpoint. Page numbering starts at 1.
            </p>
          </section>
        </div>

        <div className="lh-ref-op-code">
          <div className="lh-ref-overview-token">
            <p className="lh-ref-overview-token-title">Your API token</p>
            <TokenWidget />
          </div>
          <CodePanel snippets={exampleSnippets} title="Your first request" />
        </div>
      </div>

      <section className="lh-ref-section">
        <h2 className="lh-ref-overview-h2">Browse the API</h2>
        <div className="lh-ref-directory">
          {directory.map((group) => (
            <Link key={group.slug} href={`/reference/${group.slug}`} className="lh-ref-card">
              <div className="lh-ref-card-head">
                <span className="lh-ref-card-title">{group.title}</span>
                <span className="lh-ref-card-count">{group.count}</span>
              </div>
              <p className="lh-ref-card-desc">{group.description}</p>
              <span className="lh-ref-card-arrow">
                <ArrowRight size={14} weight="bold" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
