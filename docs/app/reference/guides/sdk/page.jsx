import Link from 'next/link'
import { API_BASE_URL } from '../../../../lib/reference/config'
import { getSpec } from '../../../../lib/reference/fetch-spec'
import { sdkCallExamples } from '../../../../lib/reference/build-model'
import { SDK_UNTYPED_PREFIXES } from '../../../../lib/reference/snippets'
import { highlight } from '../../../../lib/reference/highlight'
import { referenceMetadata } from '../../../../lib/reference/seo'
import GuidePage, { GuideSection } from '../../../../components/reference/GuidePage'
import CodePanel from '../../../../components/reference/CodePanel'
import MethodBadge from '../../../../components/reference/MethodBadge'

export const revalidate = 3600

const TITLE = 'SDK'
const LEDE =
  '@learnhouse/sdk is a typed client generated from the same OpenAPI document as this reference. Any method and path listed here is a typed call.'

export const metadata = referenceMetadata({
  title: 'Using @learnhouse/sdk with the API',
  description:
    'Map any LearnHouse API endpoint to a typed @learnhouse/sdk call: lh.GET, lh.POST, lh.PUT, lh.PATCH and lh.DELETE with path, query and body parameters.',
  path: '/reference/guides/sdk',
})

const TOC = [
  { id: 'install', title: 'Install and connect' },
  { id: 'mapping', title: 'From endpoint to call' },
  { id: 'examples', title: 'One call per group' },
  { id: 'untyped', title: 'Untyped routes' },
]

function key(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
}

function compactCall(ex) {
  const typed = !SDK_UNTYPED_PREFIXES.some((p) => ex.path.startsWith(p))
  const parts = []
  const params = []
  if (ex.pathParams.length) params.push(`path: { ${ex.pathParams.map((n) => `${key(n)}: …`).join(', ')} }`)
  if (ex.requiredQuery.length) params.push(`query: { ${ex.requiredQuery.map((n) => `${key(n)}: …`).join(', ')} }`)
  if (params.length) parts.push(`params: { ${params.join(', ')} }`)
  if (ex.hasBody && !['GET', 'DELETE'].includes(ex.method)) parts.push('body')
  const opts = parts.length ? `, { ${parts.join(', ')} }` : ''
  return typed
    ? `lh.${ex.method}("${ex.path}"${opts})`
    : `lh.request("${ex.method}", "${ex.path}"${opts})`
}

export default async function SdkGuide() {
  const spec = await getSpec()
  const examples = sdkCallExamples(spec)

  const install = await highlight('npm install @learnhouse/sdk', 'bash')
  const connect = await highlight(
    `import { createClient } from "@learnhouse/sdk";

// Server: an lh_ API token
const lh = createClient({
  baseUrl: "${API_BASE_URL}", // origin only, without /api/v1
  token: process.env.LEARNHOUSE_TOKEN,
});

// Browser on your LearnHouse domain: the session cookie
const web = createClient({ baseUrl: "${API_BASE_URL}", credentials: "include" });`,
    'javascript'
  )
  const mapping = await highlight(
    `// GET /api/v1/courses/{course_uuid}/meta?slim=true
const meta = await lh.GET("/api/v1/courses/{course_uuid}/meta", {
  params: {
    path: { course_uuid: "course_…" },  // {placeholders} in the path
    query: { slim: true },              // query parameters
  },
});

// POST /api/v1/chapters/ with a JSON body
const chapter = await lh.POST("/api/v1/chapters/", {
  body: { name: "Week 2", course_id: 12, org_id: 1 },
});

// multipart/form-data: pass a FormData body
const form = new FormData();
form.append("thumbnail", file);
await lh.PUT("/api/v1/courses/{course_uuid}/thumbnail", {
  params: { path: { course_uuid: "course_…" } },
  body: form,
});`,
    'javascript'
  )

  return (
    <GuidePage slug="sdk" title={TITLE} lede={LEDE} toc={TOC}>
      <GuideSection id="install" title="Install and connect">
        <p>
          The SDK has no runtime dependencies and runs in browsers, Node 18+, Bun, Deno, edge
          workers and React Native. Its version matches the LearnHouse release it was generated
          from. The full documentation lives at <Link href="/developers/sdk">Developers → SDK</Link>.
        </p>
        <CodePanel title="Install" snippets={{ curl: install }} tabs={[{ key: 'curl', label: 'npm' }]} />
        <CodePanel title="Create a client" snippets={{ sdk: connect }} tabs={[{ key: 'sdk', label: 'TypeScript' }]} />
      </GuideSection>

      <GuideSection id="mapping" title="From endpoint to call">
        <p>
          Take the method and path exactly as an endpoint page shows them. The method becomes{' '}
          <code>lh.GET</code>, <code>lh.POST</code>, <code>lh.PUT</code>, <code>lh.PATCH</code>{' '}
          or <code>lh.DELETE</code>; the path stays a template. Path parameters go in{' '}
          <code>params.path</code>, query parameters in <code>params.query</code> and the
          request body in <code>body</code>. Paths autocomplete, and a wrong parameter is a
          compile error. Calls return the response data or throw a <code>LearnHouseError</code>{' '}
          (see <Link href="/reference/guides/errors#handling">Errors</Link>).
        </p>
        <CodePanel title="Mapping" snippets={{ sdk: mapping }} tabs={[{ key: 'sdk', label: 'TypeScript' }]} />
        <p>
          Every endpoint&apos;s code panel has an <strong>SDK</strong> tab with the full call,
          and with your token pasted in, it is ready to run.
        </p>
      </GuideSection>

      <GuideSection id="examples" title="One call per group">
        <div className="lhr-table-wrap">
          <table className="lhr-table lhr-table-compact">
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">SDK call</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((ex) => (
                <tr key={ex.group}>
                  <td>
                    <span className="lhr-faint lhr-small">{ex.groupTitle}</span>
                    <Link href={`/reference/${ex.group}#${ex.id}`} className="lhr-oplink">
                      <MethodBadge method={ex.method} variant="bare" />
                      <code>{ex.path.replace(/^\/api\/v1/, '')}</code>
                    </Link>
                  </td>
                  <td>
                    <code className="lhr-call">{compactCall(ex)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection id="untyped" title="Untyped routes">
        <p>
          The SDK&apos;s generated types leave out internal, dev, demo, EE-only and headless
          admin routes. Those are still callable, without types, through{' '}
          <code>lh.request(method, path, options)</code>, with the same auth, retries and errors.
          In this reference that applies to paths starting with{' '}
          {SDK_UNTYPED_PREFIXES.map((p, i) => (
            <span key={p}>
              {i > 0 ? ', ' : ''}
              <code>{p}</code>
            </span>
          ))}
          ; their SDK tab already uses <code>lh.request</code>.
        </p>
      </GuideSection>
    </GuidePage>
  )
}
