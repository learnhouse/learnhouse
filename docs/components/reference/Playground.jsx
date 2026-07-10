'use client'

import { useState } from 'react'
import { Play, CaretRight } from '@phosphor-icons/react/dist/ssr'
import { useApiToken } from './TokenContext'

function buildPath(pathTemplate, pathValues, queryParams, queryValues) {
  let path = pathTemplate
  for (const p of pathValues) {
    const value = p.value?.trim()
    if (!value) return { error: `Missing path parameter “${p.name}”` }
    path = path.replaceAll(`{${p.name}}`, encodeURIComponent(value))
  }
  const qs = []
  for (const q of queryValues) {
    const value = q.value?.trim()
    if (value) qs.push(`${encodeURIComponent(q.name)}=${encodeURIComponent(value)}`)
    else if (q.required) return { error: `Missing required query parameter “${q.name}”` }
  }
  return { path: qs.length ? `${path}?${qs.join('&')}` : path }
}

/**
 * Live "Try it" panel. Requests are sent through the docs-site proxy
 * (/api/reference-proxy) because the API's CORS policy is pinned to tenant
 * domains — the proxy forwards only the Authorization header, never cookies.
 */
export default function Playground({ method, path, playground, auth }) {
  const { token } = useApiToken()
  const [open, setOpen] = useState(false)
  const [pathValues, setPathValues] = useState(
    playground.pathParams.map((p) => ({ ...p, value: '' }))
  )
  const [queryValues, setQueryValues] = useState(
    playground.queryParams.map((q) => ({ ...q, value: '' }))
  )
  const [body, setBody] = useState(playground.bodyTemplate || '')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  if (!playground.supported) {
    return (
      <div className="lh-ref-play lh-ref-play-unsupported">
        <span className="lh-ref-play-note">
          File-upload endpoints can’t run in the browser playground — use the cURL example.
        </span>
      </div>
    )
  }

  const needsToken = auth && !token

  const send = async () => {
    setResult(null)
    const built = buildPath(path, pathValues, playground.queryParams, queryValues)
    if (built.error) {
      setResult({ error: built.error })
      return
    }

    let parsedBody
    const isForm = playground.contentType === 'application/x-www-form-urlencoded'
    if (playground.bodyTemplate && body.trim() && !isForm) {
      try {
        parsedBody = JSON.parse(body)
      } catch (err) {
        setResult({ error: `Body is not valid JSON: ${err.message}` })
        return
      }
    } else if (playground.bodyTemplate && body.trim() && isForm) {
      try {
        parsedBody = JSON.parse(body)
      } catch (err) {
        setResult({ error: `Body must be a JSON object of form fields: ${err.message}` })
        return
      }
    }

    setSending(true)
    const startedAt = performance.now()
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (auth && token) headers.Authorization = `Bearer ${token}`
      const res = await fetch('/api/reference-proxy', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method,
          path: built.path,
          body: parsedBody,
          contentType: playground.contentType,
        }),
      })
      const latency = Math.round(performance.now() - startedAt)
      const text = await res.text()
      let pretty = text
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
      } catch {}
      setResult({ status: res.status, latency, body: pretty })
    } catch (err) {
      setResult({ error: `Request failed: ${err.message}` })
    } finally {
      setSending(false)
    }
  }

  const statusClass = result?.status
    ? result.status < 300
      ? 'lh-ref-play-status-ok'
      : result.status < 500
        ? 'lh-ref-play-status-warn'
        : 'lh-ref-play-status-err'
    : ''

  return (
    <div className="lh-ref-play">
      <button className="lh-ref-play-toggle" onClick={() => setOpen((v) => !v)}>
        <CaretRight
          size={11}
          weight="bold"
          className={`lh-ref-nav-caret ${open ? 'lh-ref-nav-caret-open' : ''}`}
        />
        Try it
      </button>

      {open && (
        <div className="lh-ref-play-body">
          {pathValues.length > 0 && (
            <div className="lh-ref-play-params">
              {pathValues.map((p, i) => (
                <label key={p.name} className="lh-ref-play-param">
                  <span>
                    <code>{p.name}</code> <em>path · required</em>
                  </span>
                  <input
                    value={p.value}
                    placeholder={String(p.example ?? '')}
                    spellCheck={false}
                    onChange={(e) => {
                      const next = [...pathValues]
                      next[i] = { ...p, value: e.target.value }
                      setPathValues(next)
                    }}
                  />
                </label>
              ))}
            </div>
          )}

          {queryValues.length > 0 && (
            <div className="lh-ref-play-params">
              {queryValues.map((q, i) => (
                <label key={q.name} className="lh-ref-play-param">
                  <span>
                    <code>{q.name}</code> <em>query{q.required ? ' · required' : ''}</em>
                  </span>
                  <input
                    value={q.value}
                    placeholder={String(q.example ?? '')}
                    spellCheck={false}
                    onChange={(e) => {
                      const next = [...queryValues]
                      next[i] = { ...q, value: e.target.value }
                      setQueryValues(next)
                    }}
                  />
                </label>
              ))}
            </div>
          )}

          {playground.bodyTemplate && (
            <label className="lh-ref-play-bodyfield">
              <span>
                Body{' '}
                <em>
                  {playground.contentType === 'application/x-www-form-urlencoded'
                    ? 'form fields as JSON'
                    : 'JSON'}
                </em>
              </span>
              <textarea
                value={body}
                rows={Math.min(14, (playground.bodyTemplate.match(/\n/g)?.length ?? 0) + 2)}
                spellCheck={false}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
          )}

          <div className="lh-ref-play-actions">
            <button className="lh-ref-play-send" onClick={send} disabled={sending || needsToken}>
              <Play size={12} weight="fill" />
              {sending ? 'Sending…' : 'Send request'}
            </button>
            {needsToken && (
              <span className="lh-ref-play-note">Paste your API token above to send requests.</span>
            )}
          </div>

          {result?.error && <p className="lh-ref-play-error">{result.error}</p>}
          {result?.status !== undefined && (
            <div className="lh-ref-play-result">
              <div className="lh-ref-play-result-head">
                <span className={`lh-ref-play-status ${statusClass}`}>{result.status}</span>
                <span className="lh-ref-play-latency">{result.latency} ms</span>
              </div>
              <pre className="lh-ref-play-response">{result.body || '(empty response)'}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
