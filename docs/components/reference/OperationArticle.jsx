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

export default function OperationArticle({ op }) {
  const successResponses = op.responses.filter((r) => r.status.startsWith('2'))
  const errorResponses = op.responses.filter((r) => !r.status.startsWith('2'))

  return (
    <article className="lh-ref-op" id={op.id}>
      <div className="lh-ref-op-grid">
        <div className="lh-ref-op-prose">
          <h2 className="lh-ref-op-title">
            {op.summary}
            {op.deprecated && <span className="lh-ref-pill lh-ref-pill-deprecated">deprecated</span>}
          </h2>
          <div className="lh-ref-op-endpoint">
            <MethodBadge method={op.method} />
            <PathDisplay path={op.path} />
          </div>
          <Description text={op.description} />
          {!op.auth && (
            <p className="lh-ref-op-noauth">
              This endpoint does not require an <code>Authorization</code> header.
            </p>
          )}

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

        <div className="lh-ref-op-code">
          <CodePanel snippets={op.snippets} />
          <ResponseExamples responses={op.responses} />
          <Playground method={op.method} path={op.path} playground={op.playground} auth={op.auth} />
        </div>
      </div>
    </article>
  )
}
