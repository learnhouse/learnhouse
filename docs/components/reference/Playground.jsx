'use client'

import { useEffect, useState } from 'react'
import { Play, CaretRight } from '@phosphor-icons/react/dist/ssr'
import { useApiToken } from './TokenContext'

const PARAM_STORAGE_KEY = 'lh:ref-param-values'
const HISTORY_STORAGE_KEY = 'lh:ref-history'
const HISTORY_LIMIT = 12
export const HISTORY_EVENT = 'lh-ref-history'

function loadStoredParams() {
  try {
    return JSON.parse(localStorage.getItem(PARAM_STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

/** Remember param values by name so org_slug/course_uuid etc. follow you across endpoints. */
function saveParams(values) {
  try {
    const stored = loadStoredParams()
    for (const v of values) {
      if (v.value?.trim()) stored[v.name] = v.value.trim()
    }
    localStorage.setItem(PARAM_STORAGE_KEY, JSON.stringify(stored))
  } catch {}
}

function pushHistory(entry) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]')
    history.unshift(entry)
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)))
    window.dispatchEvent(new CustomEvent(HISTORY_EVENT))
  } catch {}
}

function buildPath(pathTemplate, pathValues, queryValues) {
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

function ParamInputs({ values, onChange }) {
  if (!values.length) return null
  return (
    <div className="lh-ref-play-params">
      {values.map((p, i) => (
        <label key={p.name} className="lh-ref-play-param">
          <span>
            <code>{p.name}</code>{' '}
            <em>
              {p.kind}
              {p.required ? ' · required' : ''}
            </em>
          </span>
          <input
            value={p.value}
            placeholder={String(p.example ?? '')}
            spellCheck={false}
            onChange={(e) => onChange(i, e.target.value)}
          />
        </label>
      ))}
    </div>
  )
}

/**
 * Live "Try it" panel. Requests are sent through the docs-site proxy
 * (/api/reference-proxy) because the API's CORS policy is pinned to tenant
 * domains — the proxy forwards only the Authorization header, never cookies.
 * Multipart endpoints send FormData with method/path carried as query params.
 */
export default function Playground({ method, path, playground, auth, opId }) {
  const { token } = useApiToken()
  const [open, setOpen] = useState(false)
  const [pathValues, setPathValues] = useState(() =>
    playground.pathParams.map((p) => ({ ...p, kind: 'path', value: '' }))
  )
  const [queryValues, setQueryValues] = useState(() =>
    playground.queryParams.map((q) => ({ ...q, kind: 'query', value: '' }))
  )
  const [formValues, setFormValues] = useState(() =>
    (playground.formFields || [])
      .filter((f) => !f.binary)
      .map((f) => ({ ...f, kind: 'field', value: '' }))
  )
  const [files, setFiles] = useState({})
  const [body, setBody] = useState(playground.bodyTemplate || '')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  const binaryFields = (playground.formFields || []).filter((f) => f.binary)
  const isMultipart = playground.contentType === 'multipart/form-data'
  const needsToken = auth && !token

  // Prefill from previously used values (org_slug etc. follow the visitor).
  useEffect(() => {
    if (!open) return
    const stored = loadStoredParams()
    const prefill = (list) =>
      list.map((p) => (p.value || !stored[p.name] ? p : { ...p, value: stored[p.name] }))
    setPathValues((prev) => prefill(prev))
    setQueryValues((prev) => prefill(prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const send = async () => {
    setResult(null)
    const built = buildPath(path, pathValues, queryValues)
    if (built.error) {
      setResult({ error: built.error })
      return
    }

    setSending(true)
    const startedAt = performance.now()
    try {
      let res
      if (isMultipart) {
        const form = new FormData()
        for (const f of formValues) {
          if (f.value?.trim()) form.append(f.name, f.value)
        }
        for (const f of binaryFields) {
          const file = files[f.name]
          if (file) form.append(f.name, file)
          else if (f.required) {
            setResult({ error: `Missing required file “${f.name}”` })
            setSending(false)
            return
          }
        }
        const qs = new URLSearchParams({ method, path: built.path })
        res = await fetch(`/api/reference-proxy?${qs}`, {
          method: 'POST',
          headers: auth && token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        })
      } else {
        let parsedBody
        if (playground.bodyTemplate && body.trim()) {
          try {
            parsedBody = JSON.parse(body)
          } catch (err) {
            setResult({ error: `Body is not valid JSON: ${err.message}` })
            setSending(false)
            return
          }
        }
        const headers = { 'Content-Type': 'application/json' }
        if (auth && token) headers.Authorization = `Bearer ${token}`
        res = await fetch('/api/reference-proxy', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            method,
            path: built.path,
            body: parsedBody,
            contentType: playground.contentType,
          }),
        })
      }

      const latency = Math.round(performance.now() - startedAt)
      const text = await res.text()
      let pretty = text
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
      } catch {}
      setResult({ status: res.status, latency, body: pretty })
      saveParams([...pathValues, ...queryValues])
      pushHistory({
        method,
        path: built.path,
        status: res.status,
        opId,
        href: `${location.pathname}#${opId}`,
        ts: new Date().toISOString(),
      })
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

  const updateAt = (setter) => (i, value) =>
    setter((prev) => {
      const next = [...prev]
      next[i] = { ...next[i], value }
      return next
    })

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
          <ParamInputs values={pathValues} onChange={updateAt(setPathValues)} />
          <ParamInputs values={queryValues} onChange={updateAt(setQueryValues)} />

          {isMultipart && (
            <>
              <ParamInputs values={formValues} onChange={updateAt(setFormValues)} />
              {binaryFields.map((f) => (
                <label key={f.name} className="lh-ref-play-param">
                  <span>
                    <code>{f.name}</code> <em>file{f.required ? ' · required' : ''}</em>
                  </span>
                  <input
                    type="file"
                    className="lh-ref-play-file"
                    onChange={(e) =>
                      setFiles((prev) => ({ ...prev, [f.name]: e.target.files?.[0] || null }))
                    }
                  />
                </label>
              ))}
            </>
          )}

          {!isMultipart && playground.bodyTemplate && (
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
