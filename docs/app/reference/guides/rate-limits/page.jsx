import Link from 'next/link'
import { API_BASE_URL, TOKEN_PLACEHOLDER } from '../../../../lib/reference/config'
import { getSpec } from '../../../../lib/reference/fetch-spec'
import { paginatedOperations } from '../../../../lib/reference/build-model'
import { highlight } from '../../../../lib/reference/highlight'
import { referenceMetadata } from '../../../../lib/reference/seo'
import GuidePage, { GuideSection } from '../../../../components/reference/GuidePage'
import CodePanel from '../../../../components/reference/CodePanel'
import MethodBadge from '../../../../components/reference/MethodBadge'

export const revalidate = 3600

const TITLE = 'Rate limits & pagination'
const LEDE =
  'Limits apply to specific endpoints (sign-in, token creation, search, provisioning), not to the API as a whole. List endpoints page with page and limit, or offset and limit.'

export const metadata = referenceMetadata({
  title: 'API Rate Limits and Pagination',
  description:
    'Which LearnHouse API endpoints are rate limited, how 429 responses tell you when to retry, and how list endpoints paginate with page, limit and offset.',
  path: '/reference/guides/rate-limits',
})

const TOC = [
  { id: 'limits', title: 'Rate-limited endpoints' },
  { id: 'retry', title: 'When you hit a limit' },
  { id: 'batches', title: 'Batch sizes' },
  { id: 'pagination', title: 'Pagination' },
]

// Read from apps/api/src/services/security/rate_limiting.py and the routers
// that call it. Paths are relative to /api/v1.
const LIMITS = [
  { what: 'Sign in', routes: ['POST /auth/login', 'POST /auth/magic-link/request'], limit: '30 per 5 minutes', per: 'IP address' },
  { what: 'Refresh a session', routes: ['GET /auth/refresh'], limit: '600 per minute', per: 'IP address' },
  { what: 'Verify an email', routes: ['POST /auth/verify-email'], limit: '5 per 5 minutes', per: 'email address' },
  { what: 'Sign up', routes: ['POST /users/', 'POST /users/{org_id}', 'POST /users/{org_id}/invite/{invite_code}'], limit: '10 per hour', per: 'IP address' },
  { what: 'Accept an invite code', routes: ['POST /users/{org_id}/invite/{invite_code}'], limit: '20 per 15 minutes', per: 'IP address and organization' },
  { what: 'Password reset', routes: ['POST /users/reset_password/…'], limit: '5 per 5 minutes', per: 'email address' },
  { what: 'Create or regenerate an API token', routes: ['POST /orgs/{org_id}/api-tokens', 'POST /orgs/{org_id}/api-tokens/{token_uuid}/regenerate'], limit: '10 per hour', per: 'IP address' },
  { what: 'Create or test a webhook', routes: ['POST /orgs/{org_id}/webhooks', 'POST /orgs/{org_id}/webhooks/{webhook_uuid}/test'], limit: '20 per hour', per: 'organization, per action' },
  { what: 'Search', routes: ['GET /search/org_slug/{org_slug}', 'GET /folders/org/{org_id}/search'], limit: '60 per minute', per: 'user (a token counts as its creator)' },
  { what: 'Provision a user (headless)', routes: ['POST /admin/{org_slug}/users'], limit: '30 per minute', per: 'API token' },
  { what: 'Look up a user by email (headless)', routes: ['GET /admin/{org_slug}/users/by-email/{email}'], limit: '60 per minute', per: 'API token' },
  { what: 'Send org invites', routes: ['Invite endpoints under /orgs'], limit: '100 per day', per: 'organization, and per inviting user' },
]

const STYLE_LABEL = {
  path: 'page / limit in the path',
  query: 'page / limit query',
  offset: 'offset / limit query',
}

export default async function RateLimitsGuide() {
  const spec = await getSpec()
  const paginated = paginatedOperations(spec)
  const counts = paginated.reduce((acc, o) => ({ ...acc, [o.style]: (acc[o.style] || 0) + 1 }), {})

  const pathStyle = await highlight(
    `# page 2, 20 courses per page\ncurl "${API_BASE_URL}/api/v1/courses/org_slug/your-school/page/2/limit/20" \\\n  -H "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`,
    'bash'
  )
  const queryStyle = await highlight(
    `curl "${API_BASE_URL}/api/v1/search/org_slug/your-school?query=python&page=1&limit=10" \\\n  -H "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`,
    'bash'
  )
  const loopSdk = await highlight(
    `// Fetch every course, 50 at a time, until a short page comes back.
const all = [];
for (let page = 1; ; page++) {
  const batch = await lh.GET("/api/v1/courses/org_slug/{org_slug}/page/{page}/limit/{limit}", {
    params: { path: { org_slug: "your-school", page, limit: 50 } },
  });
  all.push(...batch);
  if (batch.length < 50) break;
}`,
    'javascript'
  )
  const retry429 = await highlight(
    `{
  "detail": {
    "code": "RATE_LIMITED",
    "message": "Too many login attempts. Please try again in 4 minutes.",
    "retry_after": 263
  }
}`,
    'json'
  )

  return (
    <GuidePage slug="rate-limits" title={TITLE} lede={LEDE} toc={TOC}>
      <GuideSection id="limits" title="Rate-limited endpoints">
        <p>
          These limits are enforced by the open-source API with fixed windows stored in Redis.
          Endpoints that are not listed have no per-endpoint limit in the API itself; your
          hosting (a proxy, LearnHouse Cloud&apos;s edge) may add its own.
        </p>
        <div className="lhr-table-wrap">
          <table className="lhr-table">
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Endpoints</th>
                <th scope="col">Limit</th>
                <th scope="col">Counted per</th>
              </tr>
            </thead>
            <tbody>
              {LIMITS.map((l) => (
                <tr key={l.what}>
                  <td>{l.what}</td>
                  <td>
                    {l.routes.map((r) => (
                      <code key={r} className="lhr-route">
                        {r}
                      </code>
                    ))}
                  </td>
                  <td className="lhr-nowrap">{l.limit}</td>
                  <td>{l.per}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection id="retry" title="When you hit a limit">
        <p>
          The API answers <code>429 Too Many Requests</code>. How long to wait comes either as a{' '}
          <code>Retry-After</code> header (seconds) or, on the sign-in endpoints, as{' '}
          <code>detail.retry_after</code> next to the <code>RATE_LIMITED</code> code. Wait at
          least that long before trying again; retrying sooner does not reset the window.
        </p>
        <CodePanel title="429 response" snippets={{ json: retry429 }} tabs={[{ key: 'json', label: 'JSON' }]} />
        <p>
          The SDK does not retry <code>429</code> for you: it retries only <code>GET</code>{' '}
          requests on network errors, timeouts and <code>5xx</code>. Catch the{' '}
          <code>LearnHouseError</code> and check <code>err.status === 429</code>. See{' '}
          <Link href="/reference/guides/errors">Errors</Link>.
        </p>
      </GuideSection>

      <GuideSection id="batches" title="Batch sizes">
        <p>
          Endpoints that take a list of users or resources in one call (adding users to a group,
          adding course contributors, removing org members) accept at most 100 items per
          request; more returns <code>400</code> with code <code>BATCH_TOO_LARGE</code> and the
          cap in <code>max_batch_size</code>. Invites are capped at 25 emails per request.
        </p>
      </GuideSection>

      <GuideSection id="pagination" title="Pagination">
        <p>
          There are no cursors. Most list endpoints return a plain array; a few (search, org
          members, submissions) return an object, so check the endpoint&apos;s response schema.
          <code> page</code> starts at <code>1</code>, <code>offset</code> at <code>0</code>.
          With arrays, keep requesting the next page until you get fewer items than{' '}
          <code>limit</code>. Endpoints use one of three styles:
        </p>
        <ul className="lhr-list">
          <li>
            <strong>Path segments</strong>, <code>…/page/{'{page}'}/limit/{'{limit}'}</code>{' '}
            ({counts.path || 0} endpoints).
          </li>
          <li>
            <strong>Query parameters</strong>, <code>?page=1&amp;limit=10</code> ({counts.query || 0}{' '}
            endpoints). Where the schema sets a maximum, it is shown below.
          </li>
          <li>
            <strong>Offset</strong>, <code>?offset=0&amp;limit=20</code> ({counts.offset || 0}{' '}
            endpoints).
          </li>
        </ul>
        <CodePanel
          title="Paginate"
          snippets={{ curl: pathStyle, js: queryStyle, sdk: loopSdk }}
          tabs={[
            { key: 'curl', label: 'Path style' },
            { key: 'js', label: 'Query style' },
            { key: 'sdk', label: 'SDK loop' },
          ]}
        />
        <div className="lhr-table-wrap">
          <table className="lhr-table lhr-table-compact">
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Style</th>
                <th scope="col">Limit</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/reference/${o.group}#${o.id}`} className="lhr-oplink">
                      <MethodBadge method={o.method} variant="bare" />
                      <code>{o.path.replace(/^\/api\/v1/, '')}</code>
                    </Link>
                  </td>
                  <td className="lhr-nowrap">{STYLE_LABEL[o.style]}</td>
                  <td className="lhr-nowrap">
                    {o.maxLimit != null ? `max ${o.maxLimit}` : '—'}
                    {o.defaultLimit != null ? `, default ${o.defaultLimit}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GuideSection>
    </GuidePage>
  )
}
