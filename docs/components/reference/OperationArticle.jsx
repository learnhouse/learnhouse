import Link from 'next/link'
import MethodBadge from './MethodBadge'
import ParamsTable from './ParamsTable'
import SchemaFields from './SchemaFields'
import CodePanel from './CodePanel'
import ResponseExamples from './ResponseExamples'
import PlaygroundLauncher from './PlaygroundLauncher'
import AnchorLink from './AnchorLink'
import CopyText from './CopyText'
import AccessNote from './AccessNote'

export function PathDisplay({ path }) {
  // Tint {placeholders} so they read as variables; allow breaks after slashes.
  const parts = path.split(/(\{[^}]+\})/g)
  return (
    <code className="lhr-path">
      {parts.map((part, i) =>
        part.startsWith('{') ? (
          <span key={i} className="lhr-path-param">
            {part}
          </span>
        ) : (
          <span key={i}>{part.replace(/\//g, '/​')}</span>
        )
      )}
    </code>
  )
}

function Description({ text }) {
  if (!text) return null
  return (
    <div className="lhr-op-desc">
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((paragraph, i) => (
          <p key={i}>{paragraph.trim()}</p>
        ))}
    </div>
  )
}

function statusTone(status) {
  return `lhr-status lhr-status-${String(status)[0]}xx`
}

function Responses({ responses }) {
  if (!responses.length) return null
  return (
    <section className="lhr-section">
      <h3 className="lhr-section-title">
        Responses
        <span className="lhr-section-count">{responses.length}</span>
      </h3>
      <div className="lhr-responses">
        {responses.map((r) => {
          const expandable = r.fields.length > 0
          const head = (
            <>
              <span className="lhr-response-code">
                <span className={statusTone(r.status)} aria-hidden="true" />
                {r.status}
              </span>
              <span className="lhr-response-desc">{r.description || 'Response'}</span>
              {r.typeLabel && <code className="lhr-response-type">{r.typeLabel}</code>}
            </>
          )
          if (r.isValidationError) {
            return (
              <div key={r.status} className="lhr-response">
                <div className="lhr-response-head">{head}</div>
                <p className="lhr-response-note">
                  A list of field errors. Same shape on every endpoint, see{' '}
                  <Link href="/reference/guides/errors#validation">validation errors</Link>.
                </p>
              </div>
            )
          }
          if (!expandable) {
            return (
              <div key={r.status} className="lhr-response">
                <div className="lhr-response-head">{head}</div>
              </div>
            )
          }
          return (
            <details key={r.status} className="lhr-response" open={r.status.startsWith('2')}>
              <summary className="lhr-response-head">{head}</summary>
              <div className="lhr-response-body">
                <SchemaFields fields={r.fields} showOptional={false} />
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}

export default function OperationArticle({ op }) {
  const examples = op.responses
    .filter((r) => r.exampleHtml)
    .map((r) => ({ status: r.status, html: r.exampleHtml }))

  return (
    <article className="lhr-op" aria-labelledby={op.id}>
      <div className="lhr-op-grid">
        <div className="lhr-op-docs">
          <h2 className="lhr-op-title" id={op.id}>
            <span>{op.summary}</span>
            {op.deprecated && <span className="lhr-tag lhr-tag-warn">Deprecated</span>}
            <AnchorLink id={op.id} label={op.summary} />
          </h2>
          <div className="lhr-endpoint">
            <MethodBadge method={op.method} />
            <PathDisplay path={op.path} />
            <CopyText text={op.path} label="Copy path" />
          </div>
          <AccessNote op={op} />
          <Description text={op.description} />

          <ParamsTable title="Path parameters" rows={op.pathParams} />
          <ParamsTable title="Query parameters" rows={op.queryParams} />

          {op.requestBody && (
            <section className="lhr-section">
              <h3 className="lhr-section-title">
                Request body
                <code className="lhr-section-ct">{op.requestBody.contentType}</code>
                {op.requestBody.required ? (
                  <span className="lhr-field-req">Required</span>
                ) : (
                  <span className="lhr-field-opt">Optional</span>
                )}
              </h3>
              {op.requestBody.fields.length ? (
                <SchemaFields fields={op.requestBody.fields} />
              ) : (
                <p className="lhr-faint">
                  <code>{op.requestBody.typeLabel || 'any'}</code>
                </p>
              )}
            </section>
          )}

          <Responses responses={op.responses} />
        </div>

        <div className="lhr-op-code" data-pagefind-ignore>
          <CodePanel snippets={op.snippets} />
          <ResponseExamples examples={examples} />
          <PlaygroundLauncher
            method={op.method}
            path={op.path}
            playground={op.playground}
            auth={op.auth}
            access={op.access}
            opId={op.id}
          />
        </div>
      </div>
    </article>
  )
}
