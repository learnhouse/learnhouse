import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from '@phosphor-icons/react/dist/ssr'
import { API_BASE_URL, BASE_URLS, GUIDES, ACCESS_LABEL } from '../../lib/reference/config'
import { getSpec } from '../../lib/reference/fetch-spec'
import { buildGroupDirectory, highlightSnippets, successExample } from '../../lib/reference/build-model'
import { buildSnippets } from '../../lib/reference/snippets'
import { highlight } from '../../lib/reference/highlight'
import { breadcrumbLd, jsonLdGraph, referenceMetadata, techArticleLd } from '../../lib/reference/seo'
import TokenWidget from '../../components/reference/TokenWidget'
import CodePanel from '../../components/reference/CodePanel'
import CopyText from '../../components/reference/CopyText'
import PageHeader from '../../components/reference/PageHeader'
import JsonLd from '../../components/reference/JsonLd'

export const revalidate = 3600

const TITLE = 'LearnHouse API Reference'
const DESCRIPTION =
  'Reference for the LearnHouse REST API: every endpoint with parameters, request and response schemas, code examples in cURL, JavaScript, Python and @learnhouse/sdk, and a live playground.'

export const metadata = referenceMetadata({ title: TITLE, description: DESCRIPTION, path: '/reference' })

// A list endpoint an lh_ token with the Courses read right can call.
const QUICKSTART_PATH = '/api/v1/courses/org_slug/{org_slug}/page/{page}/limit/{limit}'

export default async function ReferenceOverviewPage() {
  const spec = await getSpec()
  const directory = buildGroupDirectory(spec)
  const totalOps = directory.reduce((sum, g) => sum + g.count, 0)
  const version = spec.info?.version

  const quickstart = await highlightSnippets(
    buildSnippets({
      method: 'GET',
      url: `${API_BASE_URL}/api/v1/courses/org_slug/your-school/page/1/limit/10`,
      auth: true,
      path: QUICKSTART_PATH,
      pathParams: [
        { name: 'org_slug', example: 'your-school' },
        { name: 'page', example: 1 },
        { name: 'limit', example: 10 },
      ],
    })
  )
  const example = successExample(spec, 'GET', QUICKSTART_PATH)
  const exampleHtml = example ? await highlight(example.json, 'json') : null

  const jsonLd = jsonLdGraph(
    techArticleLd({ title: TITLE, description: DESCRIPTION, path: '/reference' }),
    breadcrumbLd([])
  )

  return (
    <div className="lhr-page lhr-overview">
      <JsonLd data={jsonLd} />
      <PageHeader
        pattern="dots"
        title="LearnHouse API"
        lede="A REST API over everything LearnHouse does: courses and their content, learners and groups, assignments, certificates, payments and search. Use it to build a headless learning site, sync another system or automate admin work. This reference is generated from the API's OpenAPI document, so it matches what the server accepts."
      >
        <div className="lhr-stats">
          <div className="lhr-stat">
            <span className="lhr-stat-value">{totalOps}</span>
            <span className="lhr-label">Endpoints</span>
          </div>
          <div className="lhr-stat">
            <span className="lhr-stat-value">{directory.length}</span>
            <span className="lhr-label">Groups</span>
          </div>
          {version && (
            <div className="lhr-stat">
              <span className="lhr-stat-value">{version}</span>
              <span className="lhr-label">API version</span>
            </div>
          )}
          <div className="lhr-stat">
            <span className="lhr-stat-value">REST</span>
            <span className="lhr-label">JSON over HTTP</span>
          </div>
        </div>
        <div className="lhr-actions">
          <a href="#quickstart" className="lhr-btn lhr-btn-primary">
            Make your first request
          </a>
          <Link href="/reference/guides/authentication" className="lhr-btn lhr-btn-secondary">
            Authentication
          </Link>
          <a href={`${API_BASE_URL}/openapi.json`} className="lhr-btn lhr-btn-ghost" rel="nofollow">
            OpenAPI document <ArrowUpRight size={12} weight="bold" />
          </a>
        </div>
      </PageHeader>

      <section className="lhr-block" aria-labelledby="base-urls">
        <div className="lhr-block-head">
          <h2 id="base-urls" className="lhr-h2">Base URLs</h2>
          <p className="lhr-block-lede">
            Every path in this reference starts with <code>/api/v1</code>. Put the origin of your
            deployment in front of it.
          </p>
        </div>
        <div className="lhr-grid lhr-grid-3">
          {BASE_URLS.map((b) => (
            <div key={b.key} className="lhr-card lhr-card-static">
              <span className="lhr-label">{b.label}</span>
              <div className="lhr-baseurl">
                <code>
                  {b.url}
                  <span className="lhr-faint">/api/v1</span>
                </code>
                <CopyText text={`${b.url}/api/v1`} label={`Copy ${b.label} base URL`} />
              </div>
              <p className="lhr-card-desc">{b.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lhr-block" id="quickstart" aria-labelledby="quickstart-title">
        <div className="lhr-block-head">
          <h2 id="quickstart-title" className="lhr-h2">Your first request</h2>
          <p className="lhr-block-lede">Three steps, about two minutes.</p>
        </div>
        <ol className="lhr-steps">
          <li className="lhr-step">
            <div className="lhr-step-text">
              <span className="lhr-step-num">1</span>
              <div>
                <h3 className="lhr-h3">Create an API token</h3>
                <p>
                  In your LearnHouse dashboard open <strong>Developers → API Access</strong> and
                  click <strong>Create Token</strong>. Give it the <strong>Read</strong> right on{' '}
                  <strong>Courses</strong>. The full token (it starts with <code>lh_</code>) is
                  shown once. On LearnHouse Cloud this needs the Pro plan.
                </p>
                <p>Paste it here and every example on this site uses it.</p>
              </div>
            </div>
            <div className="lhr-step-aside">
              <div className="lhr-card lhr-card-static">
                <span className="lhr-label">API token</span>
                <TokenWidget />
              </div>
            </div>
          </li>
          <li className="lhr-step">
            <div className="lhr-step-text">
              <span className="lhr-step-num">2</span>
              <div>
                <h3 className="lhr-h3">List your courses</h3>
                <p>
                  Send the token as a bearer token. Replace <code>your-school</code> with your
                  organization slug. With{' '}
                  <Link href="/reference/guides/sdk">@learnhouse/sdk</Link> the same call is typed
                  from the path.
                </p>
                <p>
                  Self-hosting? Swap <code>{API_BASE_URL}</code> for your own origin.
                </p>
              </div>
            </div>
            <div className="lhr-step-aside">
              <CodePanel snippets={quickstart} title="GET courses" />
            </div>
          </li>
          <li className="lhr-step">
            <div className="lhr-step-text">
              <span className="lhr-step-num">3</span>
              <div>
                <h3 className="lhr-h3">Read the response</h3>
                <p>
                  Successful calls return JSON. Failures return an HTTP status with a{' '}
                  <code>detail</code> field explaining why; see{' '}
                  <Link href="/reference/guides/errors">Errors</Link>. From here, browse the{' '}
                  <Link href="/reference/courses">Courses</Link> endpoints or try any endpoint
                  live with the <strong>Try it</strong> panel.
                </p>
              </div>
            </div>
            <div className="lhr-step-aside">
              {exampleHtml && (
                <CodePanel
                  snippets={{ json: exampleHtml }}
                  tabs={[{ key: 'json', label: `${example.status} · JSON` }]}
                  title="Response"
                />
              )}
            </div>
          </li>
        </ol>
      </section>

      <section className="lhr-block" aria-labelledby="guides-title">
        <div className="lhr-block-head">
          <h2 id="guides-title" className="lhr-h2">Guides</h2>
          <p className="lhr-block-lede">What applies to every endpoint.</p>
        </div>
        <div className="lhr-grid lhr-grid-4">
          {GUIDES.map((g) => (
            <Link key={g.slug} href={`/reference/guides/${g.slug}`} className="lhr-card">
              <span className="lhr-card-title">{g.title}</span>
              <p className="lhr-card-desc">{g.description}</p>
              <ArrowRight size={14} weight="bold" className="lhr-card-arrow" />
            </Link>
          ))}
        </div>
      </section>

      <section className="lhr-block" aria-labelledby="groups-title">
        <div className="lhr-block-head">
          <h2 id="groups-title" className="lhr-h2">Endpoints</h2>
          <p className="lhr-block-lede">
            {totalOps} endpoints in {directory.length} groups. Each group lists who can call it.
          </p>
        </div>
        <div className="lhr-grid lhr-grid-3">
          {directory.map((group) => (
            <Link key={group.slug} href={`/reference/${group.slug}`} className="lhr-card">
              <div className="lhr-card-row">
                <span className="lhr-card-title">{group.title}</span>
                <span className="lhr-count">{group.count}</span>
              </div>
              <p className="lhr-card-desc">{group.description}</p>
              <span className={`lhr-card-access lhr-card-access-${group.access}`}>
                {ACCESS_LABEL[group.access]}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="lhr-block lhr-block-last" aria-labelledby="machine-title">
        <div className="lhr-card lhr-card-static lhr-machine">
          <div>
            <h2 id="machine-title" className="lhr-h3">For tools and AI assistants</h2>
            <p className="lhr-card-desc">
              The whole operation list is available as Markdown and JSON, with one Markdown file
              per group that includes parameters, bodies and responses.
            </p>
          </div>
          <div className="lhr-machine-links">
            <a href="/reference/llms.txt" className="lhr-btn lhr-btn-secondary">llms.txt</a>
            <a href="/reference/operations.json" className="lhr-btn lhr-btn-secondary">operations.json</a>
            <a href={`${API_BASE_URL}/openapi.json`} className="lhr-btn lhr-btn-secondary" rel="nofollow">
              openapi.json
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
