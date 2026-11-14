'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { BookOpen, CircleNotch, PaperPlaneRight, Warning } from '@phosphor-icons/react'
import { Trans, useTranslation } from 'react-i18next'
import { getAPIUrl } from '@services/config/config'
import { INPUT, buttonClass } from '@/design'
import { buildSnippets, type HttpMethod } from '@components/Admin/Developers/snippets'
import CodeSnippetTabs from '@components/Admin/Developers/CodeSnippetTabs'
import type { EndpointDoc, PathParam } from '@components/Admin/Developers/catalog'
import OrgPicker from '@components/Admin/Developers/playground/OrgPicker'
import EELicenseError, { isEELicenseInactiveError } from '@components/Admin/EELicenseError'

const METHOD_CLS: Record<HttpMethod, string> = {
  GET: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  POST: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  PUT: 'bg-amber-50 text-amber-800 ring-amber-600/15',
  PATCH: 'bg-neutral-100 text-neutral-700 ring-neutral-900/10',
  DELETE: 'bg-rose-50 text-rose-700 ring-rose-600/15',
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
  const { t } = useTranslation()
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
  // Only the setter is used; the value is never rendered.
  const [, setBodyParseError] = useState('')

  const parsedBody: { ok: boolean; value: unknown } = useMemo(() => {
    if (!hasBody) return { ok: true, value: undefined }
    const trimmed = bodyText.trim()
    if (!trimmed) return { ok: true, value: undefined }
    try {
      return { ok: true, value: JSON.parse(trimmed) }
    } catch (e) {
      return { ok: false, value: e instanceof Error ? e.message : t('admin.developers.endpoint.invalid_json') }
    }
  }, [bodyText, hasBody, t])

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
  // Session-only endpoints always answer 403 to an API token; don't offer Send.
  const canSend =
    !endpoint.sessionOnly && !tokenMissing && missingParams.length === 0 && parsedBody.ok && !sending

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
      setError(e instanceof Error ? e.message : t('admin.developers.endpoint.network_error'))
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
              'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset font-mono ' +
              METHOD_CLS[endpoint.method]
            }
          >
            {endpoint.method}
          </span>
          <code className="font-mono text-sm text-neutral-800 break-all" dir="ltr">/{endpoint.pathTemplate}</code>
        </div>
        <h2 className="text-base font-semibold text-neutral-900">{endpoint.title}</h2>
        <p className="text-sm text-neutral-500 mt-1 leading-relaxed">{endpoint.description}</p>
        {endpoint.sessionOnly && (
          <div className="mt-3 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-600/10 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
            <Warning size={14} weight="fill" className="text-amber-600 mt-0.5 shrink-0" />
            <span>
              <Trans
                i18nKey="admin.developers.endpoint.session_only"
                components={{ strong: <strong /> }}
              />
            </span>
          </div>
        )}
      </header>

      {/* Parameters */}
      {endpoint.pathParams && endpoint.pathParams.length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wide text-neutral-400 mb-2 font-semibold">{t('admin.developers.endpoint.parameters')}</h3>
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
            <h3 className="text-[11px] uppercase tracking-wide text-neutral-400 font-semibold">{t('admin.developers.endpoint.request_body')}</h3>
            {endpoint.sampleBody != null && (
              <button
                onClick={() => setBodyText(JSON.stringify(endpoint.sampleBody, null, 2))}
                className="text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
              >
                {t('admin.developers.endpoint.reset_to_sample')}
              </button>
            )}
          </div>
          {endpoint.bodyFields && endpoint.bodyFields.length > 0 && (
            <div className="rounded-xl ring-1 ring-inset ring-neutral-200/70 bg-neutral-50 divide-y divide-neutral-100 mb-2">
              {endpoint.bodyFields.map((f) => (
                <div key={f.name} className="px-3 py-1.5 text-[11px] flex items-baseline gap-1.5">
                  <span className="font-mono text-neutral-900">{f.name}</span>
                  <span className="text-neutral-400">{f.type}</span>
                  {f.required && <span className="text-rose-500">*</span>}
                  {f.description && (
                    <span className="text-neutral-500">{f.description}</span>
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
            dir="ltr"
            className="w-full bg-neutral-50 rounded-xl ring-1 ring-inset ring-neutral-200 px-3 py-2.5 text-xs font-mono text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 resize-y"
            placeholder='{"key": "value"}'
          />
          {!parsedBody.ok && (
            <p className="text-xs text-rose-600 mt-1">{t('admin.developers.endpoint.json_parse_error', { message: String(parsedBody.value) })}</p>
          )}
        </section>
      )}

      {/* Send */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={buttonClass('primary', 'md')}
        >
          {sending ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneRight size={14} weight="fill" />}
          {sending ? t('admin.developers.endpoint.sending') : t('admin.developers.endpoint.send_request')}
        </button>
        {tokenMissing && (
          <span className="text-xs text-amber-700">
            {t('admin.developers.endpoint.paste_token')}
          </span>
        )}
        {!tokenMissing && missingParams.length > 0 && (
          <span className="text-xs text-amber-700">
            {t('admin.developers.endpoint.fill_in', { params: missingParams.join(', ') })}
          </span>
        )}
      </div>
      {error && <div className="text-sm text-rose-600">{error}</div>}

      {/* Response */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] uppercase tracking-wide text-neutral-400 font-semibold">{t('admin.developers.endpoint.response')}</h3>
          {result && (
            <span
              className={
                'inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset font-mono ' +
                (result.ok
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
                  : 'bg-rose-50 text-rose-700 ring-rose-600/15')
              }
            >
              {t('admin.developers.endpoint.http_status', { status: result.status })}
            </span>
          )}
        </div>
        {result ? (
          <>
            {/* If the API returned a deactivated-license error, show the
                explainer banner above the raw JSON so the user sees the cause
                directly instead of just a 503 detail blob. */}
            {(() => {
              // FastAPI wraps HTTPException payloads as {detail: ...}, and the
              // playground stores that whole envelope in result.body. Passing
              // it straight through meant the matcher read `.error` off the
              // wrapper, found undefined, and the banner never rendered on any
              // license 503. Unwrap first, keeping the raw body as a fallback
              // for handlers that return the detail unwrapped.
              const err = {
                status: result.status,
                detail: (result.body as { detail?: unknown })?.detail ?? result.body,
              }
              return isEELicenseInactiveError(err) ? <EELicenseError error={err} /> : null
            })()}
            <pre dir="ltr" className="rounded-xl bg-[#1d1d21] ring-1 ring-inset ring-[rgb(255_255_255/0.06)] px-3 py-2.5 text-xs font-mono text-[rgb(255_255_255/0.85)] whitespace-pre-wrap break-all overflow-x-auto max-h-96">
              {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
            </pre>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-neutral-200 py-10 text-center">
            <BookOpen size={20} className="text-neutral-300 mx-auto mb-2" />
            <p className="text-xs text-neutral-400">{t('admin.developers.endpoint.empty_response')}</p>
          </div>
        )}
      </section>

      {/* Snippets */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wide text-neutral-400 mb-2 font-semibold">{t('admin.developers.endpoint.snippet')}</h3>
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
  onChange: (_v: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="font-mono text-sm text-neutral-900">{param.name}</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] uppercase tracking-wider ring-1 ring-inset font-mono bg-neutral-100 text-neutral-500 ring-neutral-900/5">
          {t('admin.developers.endpoint.param_path')}
        </span>
        {param.required && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset font-mono bg-rose-50 text-rose-700 ring-rose-600/15">
            {t('admin.developers.endpoint.param_required')}
          </span>
        )}
        <span className="text-[11px] text-neutral-400">{param.type}</span>
        {param.description && (
          <span className="text-[11px] text-neutral-500">{param.description}</span>
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
          placeholder={param.type === 'integer' ? '42' : t('admin.developers.endpoint.param_value')}
          dir="ltr"
          className={`${INPUT} font-mono`}
        />
      )}
    </div>
  )
}
