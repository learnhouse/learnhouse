import MethodBadge from './MethodBadge'
import ParamsTable from './ParamsTable'
import SchemaFields from './SchemaFields'
import CodePanel from './CodePanel'
import ResponseExamples from './ResponseExamples'
import Playground from './Playground'

function PathDisplay({ path }) {
  // Tint {placeholders} so they read as variables.
  const parts = path.split(/(\{[^}]+\})/g)
  return (
    <code className="lh-ref-path">
      {parts.map((part, i) =>
        part.startsWith('{') ? (
          <span key={i} className="lh-ref-path-param">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </code>
  )
}

function Description({ text }) {
  if (!text) return null
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((paragraph, i) => (
      <p key={i} className="lh-ref-op-desc">
        {paragraph.trim()}
      </p>
    ))
}

const CONTENT_TYPE_LABEL = {
  'application/json': 'application/json',
  'multipart/form-data': 'multipart/form-data',
  'application/x-www-form-urlencoded': 'application/x-www-form-urlencoded',
}

/**
 * Access requirements, derived from the API's router wiring and RBAC layer
 * (see API_GROUPS in lib/reference/config.js).
 */
function AuthChips({ op }) {
  if (!op.auth) {
    return (
      <div className="lh-ref-authrow">
        <span className="lh-ref-authchip">No authentication</span>
      </div>
    )
  }
  if (op.access === 'token' || op.access === 'token-required') {
    return (
      <div className="lh-ref-authrow">
        <span className="lh-ref-authchip lh-ref-authchip-token">
          API token
          {op.tokenRight && (
            <code>
              {op.tokenRight.bucket}:{op.tokenRight.action}
            </code>
          )}
        </span>
        {op.access === 'token' ? (
          <span className="lh-ref-authchip">or user session</span>
        ) : (
          <span className="lh-ref-authchip">required — no session fallback</span>
        )}
      </div>
    )
  }
  if (op.access === 'session') {
    return (
      <div className="lh-ref-authrow">
        <span className="lh-ref-authchip lh-ref-authchip-session">
          User session only — API tokens not accepted
        </span>
      </div>
    )
  }
  return (
    <div className="lh-ref-authrow">
      <span className="lh-ref-authchip">User session</span>
    </div>
  )
}

export default function OperationArticle({ op }) {
  const successResponses = op.responses.filter((r) => r.status.startsWith('2'))
  const errorResponses = op.responses.filter((r) => !r.status.startsWith('2'))

  return (
    <article className="lh-ref-op">
      <div className="lh-ref-op-grid">
        <div className="lh-ref-op-prose">
          <h2 className="lh-ref-op-title" id={op.id}>
            {op.summary}
            {op.deprecated && <span className="lh-ref-pill lh-ref-pill-deprecated">deprecated</span>}
          </h2>
          <div className="lh-ref-op-endpoint">
            <MethodBadge method={op.method} />
            <PathDisplay path={op.path} />
          </div>
          <AuthChips op={op} />
          <Description text={op.description} />

          <ParamsTable title="Path parameters" rows={op.pathParams} />
          <ParamsTable title="Query parameters" rows={op.queryParams} />

          {op.requestBody && (
            <section className="lh-ref-section">
              <h3 className="lh-ref-section-title">
                Request body
                <span className="lh-ref-contenttype">
                  {CONTENT_TYPE_LABEL[op.requestBody.contentType] || op.requestBody.contentType}
                </span>
                {op.requestBody.required && (
                  <span className="lh-ref-pill lh-ref-pill-required">required</span>
                )}
              </h3>
              <SchemaFields fields={op.requestBody.fields} />
            </section>
          )}

          {successResponses.some((r) => r.fields.length > 0) && (
            <section className="lh-ref-section">
              <h3 className="lh-ref-section-title">Returns</h3>
              {successResponses.map(
                (r) =>
                  r.fields.length > 0 && (
                    <div key={r.status}>
                      {r.typeLabel && (
                        <p className="lh-ref-returns-type">
                          <code>{r.typeLabel}</code>
                          {r.description ? ` — ${r.description}` : ''}
                        </p>
                      )}
                      <SchemaFields fields={r.fields} />
                    </div>
                  )
              )}
            </section>
          )}

          {errorResponses.length > 0 && (
            <details className="lh-ref-errors">
              <summary>Error responses</summary>
              <ul>
                {errorResponses.map((r) => (
                  <li key={r.status}>
                    <code className="lh-ref-errors-status">{r.status}</code>{' '}
                    {r.description || 'Error'}
                    {r.typeLabel ? (
                      <>
                        {' — '}
                        <code>{r.typeLabel}</code>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="lh-ref-op-code" data-pagefind-ignore>
          <CodePanel snippets={op.snippets} />
          <ResponseExamples responses={op.responses} />
          <Playground
            method={op.method}
            path={op.path}
            playground={op.playground}
            auth={op.auth}
            opId={op.id}
          />
        </div>
      </div>
    </article>
  )
}
