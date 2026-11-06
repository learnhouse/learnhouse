import Link from 'next/link'
import { getSpec } from '../../../../lib/reference/fetch-spec'
import { validationErrorFields } from '../../../../lib/reference/build-model'
import { highlight } from '../../../../lib/reference/highlight'
import { referenceMetadata } from '../../../../lib/reference/seo'
import GuidePage, { GuideSection } from '../../../../components/reference/GuidePage'
import CodePanel from '../../../../components/reference/CodePanel'
import SchemaFields from '../../../../components/reference/SchemaFields'

export const revalidate = 3600

const TITLE = 'Errors'
const LEDE =
  'The API uses plain HTTP status codes. Every error body is JSON with a detail field: a message, an object with a machine-readable code, or a list of validation errors.'

export const metadata = referenceMetadata({
  title: 'API Errors',
  description:
    'LearnHouse API error format: HTTP status codes, the FastAPI detail field, error codes like RATE_LIMITED, and the 422 validation error structure.',
  path: '/reference/guides/errors',
})

const TOC = [
  { id: 'shape', title: 'Error body' },
  { id: 'statuses', title: 'Status codes' },
  { id: 'validation', title: 'Validation errors (422)' },
  { id: 'handling', title: 'Handling errors' },
]

const STATUSES = [
  ['400', 'Bad request', 'The request is understood but not allowed as sent: a duplicate name, a weak password, a batch over its size cap (code BATCH_TOO_LARGE).'],
  ['401', 'Unauthorized', 'No credentials, or they are invalid or expired. Detail: "Could not validate credentials".'],
  ['402', 'Payment required', 'The content or feature needs a purchase or a higher plan (code PAYMENT_REQUIRED on paid content).'],
  ['403', 'Forbidden', 'Authenticated, but not allowed: missing role or token right, or an API token on a session-only endpoint.'],
  ['404', 'Not found', 'The resource does not exist, or is not visible to you.'],
  ['409', 'Conflict', 'The request clashes with current state, for example a resource that already exists.'],
  ['413', 'Payload too large', 'A non-multipart body is over the size cap: 25 MB by default, set with max_request_body_mb on self-hosted instances. File uploads have their own per-type limits. Detail: "Request body too large".'],
  ['422', 'Unprocessable entity', 'The body, path or query failed validation. The detail is a list of field errors, below.'],
  ['429', 'Too many requests', 'A rate limit was hit. See Rate limits for which endpoints have them.'],
  ['5xx', 'Server error', 'Something failed on the server or an upstream service. Safe to retry reads with backoff.'],
]

export default async function ErrorsGuide() {
  const spec = await getSpec()
  const fields = validationErrorFields(spec)

  const stringError = await highlight(JSON.stringify({ detail: 'Course not found' }, null, 2), 'json')
  const objectError = await highlight(
    JSON.stringify(
      {
        detail: {
          code: 'RATE_LIMITED',
          message: 'Too many login attempts. Please try again in 4 minutes.',
          retry_after: 263,
        },
      },
      null,
      2
    ),
    'json'
  )
  const validation = await highlight(
    JSON.stringify(
      {
        detail: [
          {
            type: 'missing',
            loc: ['body', 'name'],
            msg: 'Field required',
            input: { description: 'An example description' },
          },
          {
            type: 'int_parsing',
            loc: ['path', 'course_id'],
            msg: 'Input should be a valid integer, unable to parse string as an integer',
            input: 'abc',
          },
        ],
      },
      null,
      2
    ),
    'json'
  )
  const sdkHandling = await highlight(
    `import { isLearnHouseError } from "@learnhouse/sdk";

try {
  await lh.GET("/api/v1/courses/{course_uuid}", {
    params: { path: { course_uuid: "course_…" } },
  });
} catch (err) {
  if (!isLearnHouseError(err)) throw err;
  err.status; // 404
  err.code;   // "HTTP_ERROR", or the API's own code, e.g. "RATE_LIMITED"
  err.detail; // the API's detail: string, object or validation list
}`,
    'javascript'
  )
  const fetchHandling = await highlight(
    `const res = await fetch(url, { headers: { Authorization: \`Bearer \${token}\` } });
if (!res.ok) {
  const { detail } = await res.json().catch(() => ({}));
  if (res.status === 422) {
    for (const e of detail) console.error(e.loc.join("."), e.msg);
  } else {
    const message = typeof detail === "string" ? detail : detail?.message;
    throw new Error(\`\${res.status}: \${message ?? res.statusText}\`);
  }
}`,
    'javascript'
  )

  return (
    <GuidePage slug="errors" title={TITLE} lede={LEDE} toc={TOC}>
      <GuideSection id="shape" title="Error body">
        <p>
          The API is built on FastAPI, so errors carry a <code>detail</code> field. Most of the
          time it is a human-readable string. Some endpoints send an object instead, with a
          stable <code>code</code> you can branch on and a <code>message</code> for people.
        </p>
        <div className="lhr-grid lhr-grid-2">
          <CodePanel title="detail as a string" snippets={{ json: stringError }} tabs={[{ key: 'json', label: '404' }]} />
          <CodePanel title="detail as an object" snippets={{ json: objectError }} tabs={[{ key: 'json', label: '429' }]} />
        </div>
        <p>
          Codes in use include <code>RATE_LIMITED</code>, <code>PAYMENT_REQUIRED</code>,{' '}
          <code>BATCH_TOO_LARGE</code>, <code>WEAK_PASSWORD</code> and the MFA codes such as{' '}
          <code>INVALID_CODE</code>. Treat unknown codes like a plain message.
        </p>
      </GuideSection>

      <GuideSection id="statuses" title="Status codes">
        <div className="lhr-table-wrap">
          <table className="lhr-table">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Meaning</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {STATUSES.map(([status, name, when]) => (
                <tr key={status}>
                  <td className="lhr-nowrap">
                    <span className={`lhr-status lhr-status-${status[0]}xx`} aria-hidden="true" />
                    <code>{status}</code>
                  </td>
                  <td className="lhr-nowrap">{name}</td>
                  <td>{when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Each endpoint lists the statuses it documents under <strong>Responses</strong>. Any
          endpoint can also return <code>401</code>, <code>403</code> or <code>5xx</code>.
        </p>
      </GuideSection>

      <GuideSection id="validation" title="Validation errors (422)">
        <p>
          When a request does not match the endpoint&apos;s schema the API answers{' '}
          <code>422</code> before running anything. <code>detail</code> is a list with one entry
          per problem. <code>loc</code> says where: the first item is <code>body</code>,{' '}
          <code>path</code> or <code>query</code>, followed by the field name (and list indexes
          for nested values).
        </p>
        <CodePanel title="422 response" snippets={{ json: validation }} tabs={[{ key: 'json', label: 'JSON' }]} />
        {fields.length > 0 && (
          <div className="lhr-card lhr-card-static lhr-schema-card">
            <p className="lhr-label">HTTPValidationError · from the OpenAPI document</p>
            <SchemaFields fields={fields} />
          </div>
        )}
      </GuideSection>

      <GuideSection id="handling" title="Handling errors">
        <p>
          With <Link href="/reference/guides/sdk">@learnhouse/sdk</Link> every failure throws a{' '}
          <code>LearnHouseError</code> carrying the status, the code and the API&apos;s detail.
          With plain <code>fetch</code>, check <code>res.ok</code> and read <code>detail</code>.
        </p>
        <CodePanel
          title="Handle errors"
          snippets={{ sdk: sdkHandling, js: fetchHandling }}
          tabs={[
            { key: 'sdk', label: 'SDK' },
            { key: 'js', label: 'fetch' },
          ]}
        />
        <p>
          Retry only what is safe: reads (<code>GET</code>) on network errors and <code>5xx</code>,
          with backoff. For <code>429</code>, wait for the time the API gives you (see{' '}
          <Link href="/reference/guides/rate-limits">Rate limits</Link>). Fix{' '}
          <code>4xx</code> errors rather than retrying them.
        </p>
      </GuideSection>
    </GuidePage>
  )
}
