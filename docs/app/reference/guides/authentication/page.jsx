import Link from 'next/link'
import { API_BASE_URL, API_GROUPS, RIGHTS_LABEL, TOKEN_PLACEHOLDER } from '../../../../lib/reference/config'
import { getSpec } from '../../../../lib/reference/fetch-spec'
import { buildGroupDirectory } from '../../../../lib/reference/build-model'
import { highlight } from '../../../../lib/reference/highlight'
import { referenceMetadata } from '../../../../lib/reference/seo'
import GuidePage, { GuideSection } from '../../../../components/reference/GuidePage'
import CodePanel from '../../../../components/reference/CodePanel'

export const revalidate = 3600

const TITLE = 'Authentication'
const LEDE =
  'The API accepts two credentials: organization API tokens (lh_…) for servers, and user session JWTs for acting as a person. Which one an endpoint takes is fixed per group.'

export const metadata = referenceMetadata({
  title: 'API Authentication',
  description:
    'Authenticate to the LearnHouse API with lh_ API tokens or user session JWTs: token rights, session-only endpoints, login, refresh and MFA.',
  path: '/reference/guides/authentication',
})

const TOC = [
  { id: 'credentials', title: 'Two kinds of credentials' },
  { id: 'api-tokens', title: 'API tokens' },
  { id: 'rights', title: 'Token rights' },
  { id: 'sessions', title: 'User sessions' },
  { id: 'by-group', title: 'Access by group' },
]

const ACCESS_TEXT = {
  token: 'API token or session',
  'token-required': 'API token only',
  session: 'Session only',
  public: 'Credentials / session',
}

export default async function AuthenticationGuide() {
  const spec = await getSpec()
  const directory = buildGroupDirectory(spec)
  const countBySlug = Object.fromEntries(directory.map((g) => [g.slug, g.count]))

  const tokenCurl = await highlight(
    `curl "${API_BASE_URL}/api/v1/courses/org_slug/your-school/page/1/limit/10" \\\n  -H "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`,
    'bash'
  )
  const tokenSdk = await highlight(
    `import { createClient } from "@learnhouse/sdk";\n\nconst lh = createClient({\n  baseUrl: "${API_BASE_URL}",\n  token: process.env.LEARNHOUSE_TOKEN, // "lh_…"\n});`,
    'javascript'
  )
  const loginCurl = await highlight(
    `curl -X POST "${API_BASE_URL}/api/v1/auth/login" \\\n  --data-urlencode 'username=ada@example.com' \\\n  --data-urlencode 'password=a-strong-password'`,
    'bash'
  )
  const loginJson = await highlight(
    JSON.stringify(
      {
        user: { id: 1, email: 'ada@example.com', username: 'ada' },
        tokens: { access_token: 'eyJhbGciOi…', refresh_token: 'eyJhbGciOi…', expiry: 1767225600000 },
      },
      null,
      2
    ),
    'json'
  )
  const sessionCurl = await highlight(
    `curl "${API_BASE_URL}/api/v1/users/profile" \\\n  -H "Authorization: Bearer YOUR_JWT"`, // gitleaks:allow (placeholder)
    'bash'
  )

  const rightsGroups = API_GROUPS.filter((g) => g.rightsBucket)
  const sessionGroups = API_GROUPS.filter((g) => g.access === 'session' && countBySlug[g.slug])

  return (
    <GuidePage slug="authentication" title={TITLE} lede={LEDE} toc={TOC}>
      <GuideSection id="credentials" title="Two kinds of credentials">
        <p>
          Both are sent the same way, as a bearer token in the <code>Authorization</code> header.
          The API tells them apart by prefix: a value starting with <code>lh_</code> is an API
          token, anything else is read as a user JWT.
        </p>
        <div className="lhr-table-wrap">
          <table className="lhr-table">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">API token</th>
                <th scope="col">User session (JWT)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Looks like</th>
                <td><code>lh_…</code></td>
                <td><code>eyJhbGciOi…</code></td>
              </tr>
              <tr>
                <th scope="row">Acts as</th>
                <td>The organization, capped by its creator&apos;s role</td>
                <td>One signed-in user</td>
              </tr>
              <tr>
                <th scope="row">Get one from</th>
                <td>Dashboard → Developers → API Access</td>
                <td><code>POST /api/v1/auth/login</code> (or the browser cookie)</td>
              </tr>
              <tr>
                <th scope="row">Lifetime</th>
                <td>Until revoked, or an optional expiry date</td>
                <td>8 hours, renewable with the refresh token</td>
              </tr>
              <tr>
                <th scope="row">Use it for</th>
                <td>Servers, scripts, headless sites, sync jobs</td>
                <td>Acting on behalf of a person; session-only endpoints</td>
              </tr>
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection id="api-tokens" title="API tokens">
        <p>
          Create tokens in the dashboard under <strong>Developers → API Access</strong>. The full
          value is shown once; LearnHouse keeps only a hash and the first 12 characters. A token
          belongs to one organization. On LearnHouse Cloud tokens need the Pro plan or higher;
          every self-hosted instance has them.
        </p>
        <CodePanel
          title="Authenticate with a token"
          snippets={{ curl: tokenCurl, sdk: tokenSdk }}
          tabs={[
            { key: 'curl', label: 'cURL' },
            { key: 'sdk', label: 'SDK' },
          ]}
        />
        <p>
          A token stops working when it is revoked or regenerated, when its expiry date passes,
          when its creator leaves the organization, or (on Cloud) when the organization drops
          below Pro. Tokens cannot manage other tokens: the{' '}
          <Link href="/reference/api-tokens">API Tokens</Link> endpoints are session-only.
          Creating and regenerating tokens is limited to 10 per hour per IP.
        </p>
      </GuideSection>

      <GuideSection id="rights" title="Token rights">
        <p>
          Each token carries <strong>Create</strong>, <strong>Read</strong>,{' '}
          <strong>Update</strong> and <strong>Delete</strong> rights per resource. The right an
          endpoint needs follows its HTTP method: <code>GET</code> needs Read, <code>POST</code>{' '}
          Create, <code>PUT</code>/<code>PATCH</code> Update and <code>DELETE</code> Delete. Every
          endpoint page shows the exact right, for example <code>courses:read</code>. A token
          missing it gets <code>403</code> with{' '}
          <code>API token does not have &apos;read&apos; permission for courses</code>.
        </p>
        <div className="lhr-table-wrap">
          <table className="lhr-table">
            <thead>
              <tr>
                <th scope="col">Dashboard resource</th>
                <th scope="col">Right key</th>
                <th scope="col">Endpoints</th>
              </tr>
            </thead>
            <tbody>
              {rightsGroups.map((g) => (
                <tr key={g.slug}>
                  <td>{RIGHTS_LABEL[g.rightsBucket] || g.rightsBucket}</td>
                  <td><code>{g.rightsBucket}</code></td>
                  <td>
                    <Link href={`/reference/${g.slug}`}>{g.title}</Link>
                    <span className="lhr-faint"> · {countBySlug[g.slug] || 0}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          A token can never do more than the user who created it: its rights are re-checked
          against the creator&apos;s current role on every request.
        </p>
      </GuideSection>

      <GuideSection id="sessions" title="User sessions">
        <p>
          Sign in with form-encoded <code>username</code> (the email) and <code>password</code>.
          The response carries an access token valid for 8 hours and a refresh token. Browsers
          also receive them as <code>HttpOnly</code> cookies (<code>LH_access</code>,{' '}
          <code>LH_refresh</code>), and the API reads the cookie when no{' '}
          <code>Authorization</code> header is sent.
        </p>
        <CodePanel title="Sign in" snippets={{ curl: loginCurl }} tabs={[{ key: 'curl', label: 'cURL' }]} />
        <CodePanel title="Response" snippets={{ json: loginJson }} tabs={[{ key: 'json', label: '200 · JSON' }]} />
        <p>
          If the account uses two-factor authentication the login answers{' '}
          <code>{'{ "mfa_required": true, "mfa_token": "…" }'}</code> instead; finish with{' '}
          <code>POST /api/v1/auth/login/mfa</code>. Logins are limited to 30 attempts per 5
          minutes per IP. Then send the access token as the bearer:
        </p>
        <CodePanel title="Call a session endpoint" snippets={{ curl: sessionCurl }} tabs={[{ key: 'curl', label: 'cURL' }]} />
        <p>
          All sign-in, refresh, logout and MFA endpoints are in{' '}
          <Link href="/reference/auth">Authentication endpoints</Link>. For the full walkthrough
          see the <Link href="/developers/api/authentication">authentication guide</Link>.
        </p>
      </GuideSection>

      <GuideSection id="by-group" title="Access by group">
        <p>
          Session-only groups answer an API token with <code>403</code> and{' '}
          <code>API tokens cannot access this resource. Only user authentication is allowed.</code>
          {' '}Within <Link href="/reference/assignments">Assignments</Link>, the learner-side
          <code> /me</code> and submission endpoints are also session-only.
        </p>
        <div className="lhr-table-wrap">
          <table className="lhr-table">
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Accepts</th>
                <th scope="col">Endpoints</th>
              </tr>
            </thead>
            <tbody>
              {API_GROUPS.filter((g) => countBySlug[g.slug]).map((g) => (
                <tr key={g.slug}>
                  <td>
                    <Link href={`/reference/${g.slug}`}>{g.title}</Link>
                  </td>
                  <td>
                    <span className={`lhr-access-pill lhr-access-pill-${g.access}`}>{ACCESS_TEXT[g.access]}</span>
                  </td>
                  <td className="lhr-num">{countBySlug[g.slug]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sessionGroups.length > 0 && (
          <p className="lhr-faint">
            Session only: {sessionGroups.map((g) => g.title).join(', ')}.
          </p>
        )}
      </GuideSection>
    </GuidePage>
  )
}
