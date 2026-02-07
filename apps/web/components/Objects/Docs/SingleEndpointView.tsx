'use client'

import React, { useState, useCallback, useMemo } from 'react'
import { Play, Loader2, Copy, Check, ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { parseOpenApiSpec, type ParsedEndpoint } from './OpenApiRenderer'

const METHOD_COLORS: Record<string, string> = {
  get: 'bg-green-500',
  post: 'bg-blue-500',
  put: 'bg-orange-500',
  patch: 'bg-purple-500',
  delete: 'bg-red-500',
}

const METHOD_TEXT: Record<string, string> = {
  get: 'text-green-700 bg-green-50 border-green-200',
  post: 'text-blue-700 bg-blue-50 border-blue-200',
  put: 'text-orange-700 bg-orange-50 border-orange-200',
  patch: 'text-purple-700 bg-purple-50 border-purple-200',
  delete: 'text-red-700 bg-red-50 border-red-200',
}

function resolveRef(spec: any, ref: string): any {
  if (!ref || !ref.startsWith('#/')) return ref
  const parts = ref.replace('#/', '').split('/')
  let current = spec
  for (const part of parts) {
    current = current?.[part]
    if (!current) return null
  }
  return current
}

function resolveSchema(spec: any, schema: any): any {
  if (!schema) return schema
  if (schema.$ref) return resolveRef(spec, schema.$ref)
  if (schema.items?.$ref) {
    return { ...schema, items: resolveRef(spec, schema.items.$ref) }
  }
  return schema
}

interface SingleEndpointViewProps {
  apiConfig: any
  method: string
  path: string
  backHref: string
}

const SingleEndpointView = ({ apiConfig, method, path, backHref }: SingleEndpointViewProps) => {
  const spec = apiConfig?.spec

  // Find the endpoint
  const endpoint = useMemo(() => {
    if (!spec) return null
    const { endpoints } = parseOpenApiSpec(
      spec,
      apiConfig.excluded_paths || [],
      apiConfig.excluded_tags || []
    )
    return endpoints.find(
      (ep) => ep.method === method.toLowerCase() && ep.path === path
    ) || null
  }, [spec, apiConfig, method, path])

  if (!endpoint) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">Endpoint not found</p>
          <p className="text-sm mt-1">{method.toUpperCase()} {path}</p>
        </div>
      </div>
    )
  }

  return (
    <article className="w-full space-y-4">
      {/* Back link */}
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to endpoints
      </Link>

      <div className="bg-white rounded-xl nice-shadow p-6 sm:p-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-xs font-bold text-white px-3 py-1 rounded ${METHOD_COLORS[endpoint.method] || 'bg-gray-500'}`}>
              {endpoint.method.toUpperCase()}
            </span>
            <code className="text-lg font-mono font-medium text-gray-900">{endpoint.path}</code>
          </div>
          {endpoint.summary && (
            <p className="text-base text-gray-700 font-medium mt-2">{endpoint.summary}</p>
          )}
          {endpoint.description && (
            <p className="text-sm text-gray-500 mt-1">{endpoint.description}</p>
          )}
          {endpoint.tags.length > 0 && (
            <div className="flex gap-1.5 mt-3">
              {endpoint.tags.map((tag) => (
                <span key={tag} className="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Parameters */}
        {endpoint.parameters.length > 0 && (
          <Section title="Parameters">
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Name</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">In</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Type</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Description</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 w-16">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoint.parameters.map((param: any, i: number) => {
                    const resolved = param.$ref ? resolveRef(spec, param.$ref) : param
                    const schema = resolveSchema(spec, resolved?.schema)
                    return (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="px-4 py-2.5 font-mono text-gray-800 text-xs font-medium">{resolved?.name}</td>
                        <td className="px-4 py-2.5">
                          <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{resolved?.in}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{schema?.type || '-'}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">{resolved?.description || '-'}</td>
                        <td className="px-4 py-2.5 text-center">
                          {resolved?.required ? (
                            <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">Yes</span>
                          ) : (
                            <span className="text-[10px] text-gray-300">No</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Request Body */}
        {endpoint.requestBody && (
          <Section title="Request Body">
            <RequestBodyDetail requestBody={endpoint.requestBody} spec={spec} />
          </Section>
        )}

        {/* Responses */}
        {Object.keys(endpoint.responses).length > 0 && (
          <Section title="Responses">
            <div className="space-y-2">
              {Object.entries(endpoint.responses).map(([code, resp]: [string, any]) => (
                <ResponseDetail key={code} code={code} response={resp} spec={spec} />
              ))}
            </div>
          </Section>
        )}

        {/* Playground */}
        <Section title="Playground">
          <Playground endpoint={endpoint} spec={spec} />
        </Section>
      </div>
    </article>
  )
}

/* ─── Section wrapper ─── */

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mb-8">
    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3 pb-2 border-b border-gray-100">
      {title}
    </h3>
    {children}
  </div>
)

/* ─── Request Body Detail ─── */

const RequestBodyDetail = ({ requestBody, spec }: { requestBody: any; spec: any }) => {
  const content = requestBody?.content
  if (!content) return <p className="text-xs text-gray-400">Request body required</p>

  const jsonContent = content['application/json']
  if (!jsonContent?.schema) return <p className="text-xs text-gray-400">Request body required</p>

  const schema = resolveSchema(spec, jsonContent.schema)
  if (!schema) return null

  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      <SchemaTree schema={schema} spec={spec} />
    </div>
  )
}

/* ─── Schema Tree ─── */

const SchemaTree = ({ schema, spec, depth = 0 }: { schema: any; spec: any; depth?: number }) => {
  if (!schema) return null
  if (depth > 5) return <span className="text-xs text-gray-400 italic">...</span>

  const resolved = schema.$ref ? resolveRef(spec, schema.$ref) : schema

  if (resolved?.type === 'object' && resolved?.properties) {
    return (
      <div className="space-y-1.5">
        {Object.entries(resolved.properties).map(([key, prop]: [string, any]) => {
          const resolvedProp = prop.$ref ? resolveRef(spec, prop.$ref) : prop
          const isRequired = resolved.required?.includes(key)
          return (
            <div key={key} className="flex items-start gap-2" style={{ paddingLeft: depth * 16 }}>
              <code className="text-xs font-mono text-gray-800 font-medium flex-shrink-0">{key}</code>
              {isRequired && <span className="text-red-500 text-[10px] font-bold flex-shrink-0">*</span>}
              <span className="text-[10px] text-gray-400 font-mono flex-shrink-0">{resolvedProp?.type || 'object'}</span>
              {resolvedProp?.description && (
                <span className="text-xs text-gray-400">— {resolvedProp.description}</span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (resolved?.type === 'array' && resolved?.items) {
    return (
      <div className="text-xs">
        <span className="text-gray-400 font-mono">array of:</span>
        <div className="ml-4 mt-1">
          <SchemaTree schema={resolved.items} spec={spec} depth={depth + 1} />
        </div>
      </div>
    )
  }

  return <span className="text-xs text-gray-400 font-mono">{resolved?.type || 'unknown'}</span>
}

/* ─── Response Detail ─── */

const ResponseDetail = ({ code, response, spec }: { code: string; response: any; spec: any }) => {
  const [expanded, setExpanded] = useState(code.startsWith('2'))
  const resolved = response.$ref ? resolveRef(spec, response.$ref) : response
  const statusColor = code.startsWith('2')
    ? 'text-green-700 bg-green-50 border-green-200'
    : code.startsWith('4')
      ? 'text-orange-700 bg-orange-50 border-orange-200'
      : code.startsWith('5')
        ? 'text-red-700 bg-red-50 border-red-200'
        : 'text-gray-600 bg-gray-50 border-gray-200'

  const hasSchema = resolved?.content?.['application/json']?.schema

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => hasSchema && setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className={`text-xs font-bold px-2 py-0.5 rounded border ${statusColor}`}>{code}</span>
        <span className="text-sm text-gray-600 flex-1">{resolved?.description || ''}</span>
        {hasSchema && (
          expanded ? <ChevronDown size={14} className="text-gray-300" /> : <ChevronRight size={14} className="text-gray-300" />
        )}
      </button>
      {expanded && hasSchema && (
        <div className="px-4 pb-4 border-t bg-gray-50">
          <div className="pt-3">
            <SchemaTree schema={resolveSchema(spec, hasSchema)} spec={spec} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Playground ─── */

const Playground = ({ endpoint, spec }: { endpoint: ParsedEndpoint; spec: any }) => {
  const baseUrl = spec?.servers?.[0]?.url || ''

  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {}
    for (const param of endpoint.parameters) {
      const resolved = param.$ref ? resolveRef(spec, param.$ref) : param
      if (resolved?.name) {
        defaults[resolved.name] = resolved.schema?.default?.toString() || resolved.example?.toString() || ''
      }
    }
    return defaults
  })

  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([
    { key: 'Content-Type', value: 'application/json' },
  ])

  const [body, setBody] = useState(() => {
    const jsonContent = endpoint.requestBody?.content?.['application/json']
    const schema = jsonContent?.schema ? resolveSchema(spec, jsonContent.schema) : null
    if (schema?.example) return JSON.stringify(schema.example, null, 2)
    return '{}'
  })

  const [response, setResponse] = useState<{
    status: number
    statusText: string
    body: string
    time: number
    headers: Record<string, string>
  } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const buildUrl = useCallback(() => {
    let url = baseUrl + endpoint.path
    for (const param of endpoint.parameters) {
      const resolved = param.$ref ? resolveRef(spec, param.$ref) : param
      if (resolved?.in === 'path' && paramValues[resolved.name]) {
        url = url.replace(`{${resolved.name}}`, encodeURIComponent(paramValues[resolved.name]))
      }
    }
    const queryParams = endpoint.parameters
      .map((p: any) => (p.$ref ? resolveRef(spec, p.$ref) : p))
      .filter((p: any) => p?.in === 'query' && paramValues[p.name])
    if (queryParams.length > 0) {
      const qs = queryParams
        .map((p: any) => `${encodeURIComponent(p.name)}=${encodeURIComponent(paramValues[p.name])}`)
        .join('&')
      url += (url.includes('?') ? '&' : '?') + qs
    }
    return url
  }, [baseUrl, endpoint, paramValues, spec])

  const handleSend = async () => {
    const fullUrl = buildUrl()
    if (!fullUrl) {
      setError('No URL configured')
      return
    }

    setIsLoading(true)
    setError(null)
    setResponse(null)

    const startTime = Date.now()
    try {
      const fetchHeaders: Record<string, string> = {}
      for (const h of headers) {
        if (h.key && h.value) fetchHeaders[h.key] = h.value
      }

      const fetchOptions: RequestInit = {
        method: endpoint.method.toUpperCase(),
        headers: fetchHeaders,
      }
      if (['post', 'put', 'patch'].includes(endpoint.method) && body) {
        fetchOptions.body = body
      }

      const res = await fetch(fullUrl, fetchOptions)
      const elapsed = Date.now() - startTime

      const resHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { resHeaders[k] = v })

      let resBody = ''
      try {
        const text = await res.text()
        try {
          resBody = JSON.stringify(JSON.parse(text), null, 2)
        } catch {
          resBody = text
        }
      } catch {
        resBody = 'Unable to read response body'
      }

      setResponse({ status: res.status, statusText: res.statusText, body: resBody, time: elapsed, headers: resHeaders })
    } catch (err: any) {
      setError(err.message || 'Request failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = () => {
    if (response?.body) {
      navigator.clipboard.writeText(response.body)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const statusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-green-700 bg-green-50'
    if (status >= 400 && status < 500) return 'text-orange-700 bg-orange-50'
    if (status >= 500) return 'text-red-700 bg-red-50'
    return 'text-gray-600 bg-gray-50'
  }

  const editableParams = endpoint.parameters
    .map((p: any) => (p.$ref ? resolveRef(spec, p.$ref) : p))
    .filter(Boolean)

  return (
    <div className="space-y-4 border rounded-xl p-5 bg-gray-50">
      {/* URL bar */}
      <div className="flex items-center gap-2 p-3 bg-white rounded-lg border">
        <span className={`text-[11px] font-bold text-white px-2.5 py-1 rounded ${METHOD_COLORS[endpoint.method] || 'bg-gray-500'}`}>
          {endpoint.method.toUpperCase()}
        </span>
        <code className="text-sm font-mono text-gray-700 truncate flex-1">{buildUrl()}</code>
        <button
          onClick={handleSend}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Send
        </button>
      </div>

      {/* Parameters */}
      {editableParams.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 mb-2">Parameters</h4>
          <div className="space-y-2 bg-white rounded-lg border p-3">
            {editableParams.map((param: any) => (
              <div key={param.name} className="flex items-center gap-3">
                <code className="text-xs text-gray-700 font-medium w-32 truncate">{param.name}</code>
                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded w-14 text-center">{param.in}</span>
                <input
                  type="text"
                  value={paramValues[param.name] || ''}
                  onChange={(e) => setParamValues({ ...paramValues, [param.name]: e.target.value })}
                  className="flex-1 px-3 py-1.5 border rounded-lg text-sm font-mono focus:ring-1 focus:ring-gray-300 focus:outline-none"
                  placeholder={param.schema?.type || 'value'}
                />
                {param.required && <span className="text-red-500 text-xs font-bold">*</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Headers */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 mb-2">Headers</h4>
        <div className="space-y-2 bg-white rounded-lg border p-3">
          {headers.map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={h.key}
                onChange={(e) => {
                  const next = [...headers]
                  next[i] = { ...next[i], key: e.target.value }
                  setHeaders(next)
                }}
                className="w-40 px-3 py-1.5 border rounded-lg text-sm font-mono focus:ring-1 focus:ring-gray-300 focus:outline-none"
                placeholder="Header name"
              />
              <input
                type="text"
                value={h.value}
                onChange={(e) => {
                  const next = [...headers]
                  next[i] = { ...next[i], value: e.target.value }
                  setHeaders(next)
                }}
                className="flex-1 px-3 py-1.5 border rounded-lg text-sm font-mono focus:ring-1 focus:ring-gray-300 focus:outline-none"
                placeholder="Value"
              />
              <button
                onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                className="text-xs text-gray-300 hover:text-red-400 px-1"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => setHeaders([...headers, { key: '', value: '' }])}
            className="text-xs text-gray-400 hover:text-gray-600 font-medium"
          >
            + Add header
          </button>
        </div>
      </div>

      {/* Body */}
      {['post', 'put', 'patch'].includes(endpoint.method) && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 mb-2">Body</h4>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full px-4 py-3 border rounded-lg text-sm font-mono resize-y bg-white focus:ring-1 focus:ring-gray-300 focus:outline-none"
            rows={8}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {/* Response */}
      {response && (
        <div className="border rounded-xl overflow-hidden bg-white">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
            <div className="flex items-center gap-3">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${statusColor(response.status)}`}>
                {response.status} {response.statusText}
              </span>
              <span className="text-xs text-gray-400">{response.time}ms</span>
            </div>
            <button
              onClick={handleCopy}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-4 text-sm font-mono text-gray-700 overflow-auto max-h-[500px]">
            {response.body || '(empty response)'}
          </pre>
        </div>
      )}
    </div>
  )
}

export default SingleEndpointView
