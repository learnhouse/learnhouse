'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { BookOpen, CircleNotch, PaperPlaneRight, Warning } from '@phosphor-icons/react'
import { getAPIUrl } from '@services/config/config'
import { buildSnippets, type HttpMethod } from '@components/Admin/Developers/snippets'
import CodeSnippetTabs from '@components/Admin/Developers/CodeSnippetTabs'
import type { EndpointDoc, PathParam } from '@components/Admin/Developers/catalog'
import OrgPicker from '@components/Admin/Developers/playground/OrgPicker'
import EELicenseError, { isEELicenseInactiveError } from '@components/Admin/EELicenseError'

const METHOD_CLS: Record<HttpMethod, string> = {
  GET: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
  POST: 'bg-sky-400/10 text-sky-300 border-sky-400/20',
  PUT: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  PATCH: 'bg-violet-400/10 text-violet-300 border-violet-400/20',
  DELETE: 'bg-red-400/10 text-red-300 border-red-400/20',
}

interface CallResult {
  status: number
  ok: boolean
  body: unknown
}

function fillTemplate(template: string, params: Record<string, string>): { resolved: string; missing: string[] } {
  const missing: string[] = []
  const resolved = template.replace(/\{([^}]+)\}/g, (_, key) => {
    const v = params[key]
    if (v === undefined || v === '') {
      missing.push(key)
      return `{${key}}`
    }
    return encodeURIComponent(v)
  })
  return { resolved, missing }
}

export default function EndpointDetail({
  endpoint,
  token,
}: {
  endpoint: EndpointDoc
  token: string
}) {
  // ── Path params state ────────────────────────────────────────────────────
  const [pathValues, setPathValues] = useState<Record<string, string>>({})
  // Reset per-endpoint state when the user picks a different endpoint.
  useEffect(() => {
    setPathValues({})
    setBodyText(endpoint.sampleBody ? JSON.stringify(endpoint.sampleBody, null, 2) : '')
    setResult(null)
    setError('')
    setBodyParseError('')
  }, [endpoint.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Body editor state ────────────────────────────────────────────────────
  const hasBody = endpoint.method !== 'GET' && endpoint.method !== 'DELETE'
  const [bodyText, setBodyText] = useState<string>(
    endpoint.sampleBody ? JSON.stringify(endpoint.sampleBody, null, 2) : '',
  )
  const [bodyParseError, setBodyParseError] = useState('')

  const parsedBody: { ok: boolean; value: unknown } = useMemo(() => {
    if (!hasBody) return { ok: true, value: undefined }
    const t = bodyText.trim()
    if (!t) return { ok: true, value: undefined }
    try {
      return { ok: true, value: JSON.parse(t) }
    } catch (e) {
      return { ok: false, value: e instanceof Error ? e.message : 'Invalid JSON' }
    }
  }, [bodyText, hasBody])

  // ── Compute URL + snippets ───────────────────────────────────────────────
  const apiBase = getAPIUrl().replace(/\/$/, '')
  const { resolved: filledPath, missing: missingParams } = fillTemplate(endpoint.pathTemplate, pathValues)
  const url = `${apiBase}/${filledPath.replace(/^\//, '')}`

  const snippets = useMemo(
    () =>
      buildSnippets({
        method: endpoint.method,
        url,
        body: hasBody && parsedBody.ok ? parsedBody.value : undefined,
        token,
      }),
    [endpoint.method, url, hasBody, parsedBody, token],
  )

  // ── Send state ───────────────────────────────────────────────────────────
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<CallResult | null>(null)
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const tokenMissing = !token.trim()
  const canSend =
    !tokenMissing && missingParams.length === 0 && parsedBody.ok && !sending

  const handleSend = async () => {
    setSending(true)
    setError('')
    setResult(null)
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token.trim()}`,
      }
      const init: RequestInit = { method: endpoint.method, headers }
      if (hasBody && parsedBody.ok && parsedBody.value !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(parsedBody.value)
      }
      const res = await fetch(url, init)
      const text = await res.text()
      let data: unknown = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = text
      }
      setResult({ status: res.status, ok: res.ok, body: data })
      // Invalidate cached org list when an org mutation succeeds.
      if (res.ok && endpoint.category === 'Organizations' && endpoint.method !== 'GET') {
        qc.invalidateQueries({ queryKey: queryKeys.superadmin.orgs() })
      }
      if (res.ok && endpoint.category === 'Tokens' && endpoint.method !== 'GET') {
        qc.invalidateQueries({ queryKey: queryKeys.superadmin.apiTokens() })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <header>
        <div className="flex items-center gap-2 mb-2">
          <span
            className={
              'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border font-mono ' +
              METHOD_CLS[endpoint.method]
            }
          >
            {endpoint.method}
          </span>
          <code className="font-mono text-sm text-white/90 break-all">/{endpoint.pathTemplate}</code>
        </div>
        <h2 className="text-base font-semibold text-white">{endpoint.title}</h2>
        <p className="text-xs text-white/50 mt-1 leading-relaxed">{endpoint.description}</p>
        {endpoint.sessionOnly && (
          <div className="mt-3 rounded-lg bg-amber-400/[0.06] border border-amber-400/20 px-3 py-2 text-xs text-amber-200/90 flex items-start gap-2">
            <Warning size={14} weight="fill" className="text-amber-300 mt-0.5 shrink-0" />
            <span>
              <strong>Session auth only.</strong> API tokens cannot call this endpoint
              (privilege-escalation block). The live Send button will fail with 403 if you use a token —
              copy the snippet and run it as a logged-in superadmin instead.
            </span>
          </div>
        )}
      </header>

      {/* Parameters */}
      {endpoint.pathParams && endpoint.pathParams.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-2 font-semibold">Parameters</h3>
          <div className="space-y-3">
            {endpoint.pathParams.map((p) => (
              <ParamRow
                key={p.name}
                param={p}
                value={pathValues[p.name] ?? ''}
                onChange={(v) =>
                  setPathValues((s) => ({ ...s, [p.name]: v }))
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Request Body */}
      {hasBody && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold">Request Body (JSON)</h3>
            {endpoint.sampleBody != null && (
              <button
                onClick={() => setBodyText(JSON.stringify(endpoint.sampleBody, null, 2))}
                className="text-[11px] text-white/40 hover:text-white/70 transition-colors"
              >
                Reset to sample
              </button>
            )}
          </div>
          {endpoint.bodyFields && endpoint.bodyFields.length > 0 && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.04] mb-2">
              {endpoint.bodyFields.map((f) => (
                <div key={f.name} className="px-3 py-1.5 text-[11px] flex items-baseline gap-1.5">
                  <span className="font-mono text-white/90">{f.name}</span>
                  <span className="text-white/40">{f.type}</span>
                  {f.required && <span className="text-red-400/80">*</span>}
                  {f.description && (
                    <span className="text-white/40">— {f.description}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <textarea
            value={bodyText}
            onChange={(e) => {
              setBodyText(e.target.value)
              setBodyParseError('')
            }}
            spellCheck={false}
            rows={Math.min(20, Math.max(6, bodyText.split('\n').length + 1))}
            className="w-full bg-black/40 border border-white/[0.1] rounded-lg px-3 py-2.5 text-xs font-mono text-white/90 focus:outline-none focus:border-white/30 resize-y"
            placeholder='{"key": "value"}'
          />
          {!parsedBody.ok && (
            <p className="text-xs text-red-400 mt-1">JSON parse error: {String(parsedBody.value)}</p>
          )}
        </section>
      )}

      {/* Send */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-black text-sm font-medium rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneRight size={14} weight="fill" />}
          {sending ? 'Sending…' : 'Send Request'}
        </button>
        {tokenMissing && (
          <span className="text-xs text-amber-300/80">
            Paste a token at the top to enable live calls.
          </span>
        )}
        {!tokenMissing && missingParams.length > 0 && (
          <span className="text-xs text-amber-300/80">
            Fill in: {missingParams.join(', ')}
          </span>
        )}
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}

      {/* Response */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold">Response</h3>
          {result && (
            <span
              className={
                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border font-mono ' +
                (result.ok
                  ? 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20'
                  : 'bg-red-400/10 text-red-300 border-red-400/20')
              }
            >
              HTTP {result.status}
            </span>
          )}
        </div>
        {result ? (
          <>
            {/* If the API returned a deactivated-license error, show the
                explainer banner above the raw JSON so the user sees the cause
                directly instead of just a 503 detail blob. */}
            {isEELicenseInactiveError({ status: result.status, detail: result.body }) && (
              <EELicenseError error={{ status: result.status, detail: result.body }} />
            )}
            <pre className="rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2.5 text-xs font-mono text-white/85 whitespace-pre-wrap break-all overflow-x-auto max-h-96">
              {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
            </pre>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-white/[0.08] py-10 text-center">
            <BookOpen size={20} weight="fill" className="text-white/20 mx-auto mb-2" />
            <p className="text-xs text-white/40">Send a request to see the response</p>
          </div>
        )}
      </section>

      {/* Snippets */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-white/40 mb-2 font-semibold">Snippet</h3>
        <CodeSnippetTabs snippets={snippets} />
      </section>
    </div>
  )
}

function ParamRow({
  param,
  value,
  onChange,
}: {
  param: PathParam
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="font-mono text-sm text-white">{param.name}</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border font-mono bg-white/[0.04] text-white/50 border-white/10">
          path
        </span>
        {param.required && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border font-mono bg-red-400/10 text-red-300 border-red-400/20">
            required
          </span>
        )}
        <span className="text-[11px] text-white/40">{param.type}</span>
        {param.description && (
          <span className="text-[11px] text-white/40">— {param.description}</span>
        )}
      </div>
      {param.picker === 'org_id' ? (
        <OrgPicker
          value={value === '' ? '' : Number(value)}
          onChange={(v) => onChange(v === '' ? '' : String(v))}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={param.type === 'integer' ? '42' : 'value'}
          className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 font-mono"
        />
      )}
    </div>
  )
}
