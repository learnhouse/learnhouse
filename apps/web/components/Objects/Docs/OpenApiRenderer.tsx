'use client'

import React, { useState, useCallback, useMemo } from 'react'
import { Play, Loader2, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react'

interface OpenApiRendererProps {
  apiConfig: {
    spec?: any
    source_url?: string
    excluded_paths?: string[]
    excluded_tags?: string[]
  }
  /** When true, tag sections start collapsed (used in ALL view) */
  defaultCollapsed?: boolean
  /** When set, only show endpoints for this tag */
  filterTag?: string
}

const METHOD_COLORS: Record<string, string> = {
  get: 'bg-green-500',
  post: 'bg-blue-500',
  put: 'bg-orange-500',
  patch: 'bg-purple-500',
  delete: 'bg-red-500',
}

const METHOD_BG: Record<string, string> = {
  get: 'bg-green-50 border-green-200',
  post: 'bg-blue-50 border-blue-200',
  put: 'bg-orange-50 border-orange-200',
  patch: 'bg-purple-50 border-purple-200',
  delete: 'bg-red-50 border-red-200',
}

export interface ParsedEndpoint {
  method: string
  path: string
  summary: string
  description: string
  operationId: string
  tags: string[]
  parameters: any[]
  requestBody: any
  responses: any
}

export function endpointId(ep: { method: string; path: string }): string {
  return `ep-${ep.method}-${ep.path}`.replace(/[^a-zA-Z0-9-]/g, '-')
}

export function parseOpenApiSpec(spec: any, excludedPaths: string[], excludedTags: string[]): { endpoints: ParsedEndpoint[]; tags: string[]; info: any } {
  if (!spec || !spec.paths) return { endpoints: [], tags: [], info: spec?.info || {} }

  const endpoints: ParsedEndpoint[] = []
  const allTags = new Set<string>()
  const methods = ['get', 'post', 'put', 'patch', 'delete']

  for (const [path, pathItem] of Object.entries(spec.paths as Record<string, any>)) {
    if (excludedPaths.includes(path)) continue

    for (const method of methods) {
      const operation = pathItem[method]
      if (!operation) continue

      const opTags = operation.tags || ['default']
      const isExcluded = opTags.some((t: string) => excludedTags.includes(t))
      if (isExcluded) continue

      opTags.forEach((t: string) => allTags.add(t))

      // Resolve parameters (merge path-level and operation-level)
      const pathParams = pathItem.parameters || []
      const opParams = operation.parameters || []
      const allParams = [...pathParams, ...opParams]

      endpoints.push({
        method,
        path,
        summary: operation.summary || '',
        description: operation.description || '',
        operationId: operation.operationId || '',
        tags: opTags,
        parameters: allParams,
        requestBody: operation.requestBody || null,
        responses: operation.responses || {},
      })
    }
  }

  return { endpoints, tags: Array.from(allTags).sort(), info: spec?.info || {} }
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

const OpenApiRenderer = ({ apiConfig, defaultCollapsed = false, filterTag }: OpenApiRendererProps) => {
  const spec = apiConfig?.spec
  const excludedPaths = apiConfig?.excluded_paths || []
  const excludedTags = apiConfig?.excluded_tags || []

  const { endpoints, tags: allTags, info } = useMemo(
    () => parseOpenApiSpec(spec, excludedPaths, excludedTags),
    [spec, excludedPaths, excludedTags]
  )

  // Filter to a single tag if specified
  const tags = filterTag ? allTags.filter((t) => t === filterTag) : allTags

  const [expandedTags, setExpandedTags] = useState<Set<string>>(
    () => defaultCollapsed ? new Set<string>() : new Set(tags)
  )

  if (!spec) {
    return (
      <div className="text-center text-gray-400 py-12">
        <p className="text-lg font-medium">No API specification configured</p>
        <p className="text-sm mt-1">Upload an OpenAPI spec or provide a URL in the dashboard.</p>
      </div>
    )
  }

  if (endpoints.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        <p className="text-lg font-medium">No endpoints found</p>
        <p className="text-sm mt-1">The specification may be empty or all endpoints are excluded.</p>
      </div>
    )
  }

  // Group endpoints by tag
  const byTag: Record<string, ParsedEndpoint[]> = {}
  for (const ep of endpoints) {
    for (const tag of ep.tags) {
      if (!byTag[tag]) byTag[tag] = []
      byTag[tag].push(ep)
    }
  }

  return (
    <div className="space-y-2">
      {/* API info header */}
      {info?.title && (
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">{info.title}</h2>
          {info.version && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded ml-2">{info.version}</span>}
          {info.description && <p className="text-sm text-gray-600 mt-2">{info.description}</p>}
        </div>
      )}

      {/* Base URL */}
      {spec.servers?.[0]?.url && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 mb-4">
          <span className="text-xs font-medium text-gray-500">Base URL</span>
          <code className="text-xs font-mono text-gray-700">{spec.servers[0].url}</code>
        </div>
      )}

      {/* Endpoints grouped by tag */}
      {tags.map((tag) => {
        const isExpanded = expandedTags.has(tag)
        return (
          <div key={tag} className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => {
                setExpandedTags((prev) => {
                  const next = new Set(prev)
                  if (next.has(tag)) next.delete(tag)
                  else next.add(tag)
                  return next
                })
              }}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                <span className="text-sm font-semibold text-gray-700">{tag}</span>
                <span className="text-xs text-gray-400">{byTag[tag]?.length || 0} endpoints</span>
              </div>
            </button>
            {isExpanded && (
              <div className="divide-y divide-gray-100">
                {byTag[tag]?.map((ep, i) => (
                  <EndpointItem key={`${ep.method}-${ep.path}-${i}`} endpoint={ep} spec={spec} id={endpointId(ep)} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ─── Single Endpoint ─── */

const EndpointItem = ({ endpoint, spec, id }: { endpoint: ParsedEndpoint; spec: any; id?: string }) => {
  const [expanded, setExpanded] = useState(false)
  const [tryItOpen, setTryItOpen] = useState(false)

  return (
    <div id={id}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left ${expanded ? 'bg-gray-50' : ''}`}
      >
        <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded ${METHOD_COLORS[endpoint.method] || 'bg-gray-500'}`}>
          {endpoint.method.toUpperCase()}
        </span>
        <code className="text-sm font-mono text-gray-700 flex-1">{endpoint.path}</code>
        {endpoint.summary && (
          <span className="text-xs text-gray-400 truncate max-w-[40%]">{endpoint.summary}</span>
        )}
        {expanded ? <ChevronDown size={14} className="text-gray-300" /> : <ChevronRight size={14} className="text-gray-300" />}
      </button>

      {expanded && (
        <div className={`px-4 pb-4 pt-2 border-l-4 ml-4 mr-4 mb-2 rounded-b-lg ${METHOD_BG[endpoint.method] || 'bg-gray-50 border-gray-200'}`}>
          {endpoint.description && (
            <p className="text-sm text-gray-600 mb-4">{endpoint.description}</p>
          )}

          {/* Parameters */}
          {endpoint.parameters.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Parameters</h4>
              <div className="border rounded-lg overflow-hidden bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Name</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">In</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Type</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Description</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-12">Req</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoint.parameters.map((param: any, i: number) => {
                      const resolved = param.$ref ? resolveRef(spec, param.$ref) : param
                      const schema = resolveSchema(spec, resolved?.schema)
                      return (
                        <tr key={i} className="border-b last:border-b-0">
                          <td className="px-3 py-2 font-mono text-gray-700 text-xs">{resolved?.name}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{resolved?.in}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{schema?.type || '-'}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{resolved?.description || '-'}</td>
                          <td className="px-3 py-2 text-center">
                            {resolved?.required && <span className="text-red-500 text-xs font-bold">*</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Request Body */}
          {endpoint.requestBody && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Request Body</h4>
              <RequestBodyDisplay requestBody={endpoint.requestBody} spec={spec} />
            </div>
          )}

          {/* Responses */}
          {Object.keys(endpoint.responses).length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Responses</h4>
              <div className="space-y-1">
                {Object.entries(endpoint.responses).map(([code, resp]: [string, any]) => (
                  <ResponseItem key={code} code={code} response={resp} spec={spec} />
                ))}
              </div>
            </div>
          )}

          {/* Try it button */}
          <button
            onClick={() => setTryItOpen(!tryItOpen)}
            className="flex items-center gap-1.5 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Play size={14} />
            {tryItOpen ? 'Hide Playground' : 'Try It'}
          </button>

          {tryItOpen && (
            <div className="mt-3">
              <EndpointPlayground endpoint={endpoint} spec={spec} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Request Body Display ─── */

const RequestBodyDisplay = ({ requestBody, spec }: { requestBody: any; spec: any }) => {
  const content = requestBody?.content
  if (!content) return null

  const jsonContent = content['application/json']
  if (!jsonContent?.schema) return <p className="text-xs text-gray-400">Request body required</p>

  const schema = resolveSchema(spec, jsonContent.schema)
  if (!schema) return null

  return (
    <div className="bg-white border rounded-lg p-3">
      <SchemaDisplay schema={schema} spec={spec} />
    </div>
  )
}

/* ─── Schema Display ─── */

const SchemaDisplay = ({ schema, spec, depth = 0 }: { schema: any; spec: any; depth?: number }) => {
  if (!schema) return null
  if (depth > 4) return <span className="text-xs text-gray-400">...</span>

  const resolved = schema.$ref ? resolveRef(spec, schema.$ref) : schema

  if (resolved?.type === 'object' && resolved?.properties) {
    return (
      <div className="space-y-1">
        {Object.entries(resolved.properties).map(([key, prop]: [string, any]) => {
          const resolvedProp = prop.$ref ? resolveRef(spec, prop.$ref) : prop
          const isRequired = resolved.required?.includes(key)
          return (
            <div key={key} className="flex items-start gap-2 text-xs" style={{ paddingLeft: depth * 12 }}>
              <span className="font-mono text-gray-700 font-medium">{key}</span>
              {isRequired && <span className="text-red-500 font-bold">*</span>}
              <span className="text-gray-400">{resolvedProp?.type || 'object'}</span>
              {resolvedProp?.description && (
                <span className="text-gray-400 truncate">— {resolvedProp.description}</span>
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
        <span className="text-gray-400">array of:</span>
        <SchemaDisplay schema={resolved.items} spec={spec} depth={depth + 1} />
      </div>
    )
  }

  return <span className="text-xs text-gray-400">{resolved?.type || 'unknown'}</span>
}

/* ─── Response Item ─── */

const ResponseItem = ({ code, response, spec }: { code: string; response: any; spec: any }) => {
  const [expanded, setExpanded] = useState(false)
  const resolved = response.$ref ? resolveRef(spec, response.$ref) : response

  const statusColor = code.startsWith('2') ? 'text-green-600 bg-green-50' : code.startsWith('4') ? 'text-orange-600 bg-orange-50' : code.startsWith('5') ? 'text-red-600 bg-red-50' : 'text-gray-600 bg-gray-50'

  const hasSchema = resolved?.content?.['application/json']?.schema

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => hasSchema && setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
      >
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${statusColor}`}>{code}</span>
        <span className="text-xs text-gray-600 flex-1">{resolved?.description || ''}</span>
        {hasSchema && (expanded ? <ChevronDown size={12} className="text-gray-300" /> : <ChevronRight size={12} className="text-gray-300" />)}
      </button>
      {expanded && hasSchema && (
        <div className="px-3 pb-3 border-t">
          <SchemaDisplay schema={resolveSchema(spec, hasSchema)} spec={spec} />
        </div>
      )}
    </div>
  )
}

/* ─── Endpoint Playground ─── */

const EndpointPlayground = ({ endpoint, spec }: { endpoint: ParsedEndpoint; spec: any }) => {
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
  } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const buildUrl = useCallback(() => {
    let url = baseUrl + endpoint.path
    // Replace path params
    for (const param of endpoint.parameters) {
      const resolved = param.$ref ? resolveRef(spec, param.$ref) : param
      if (resolved?.in === 'path' && paramValues[resolved.name]) {
        url = url.replace(`{${resolved.name}}`, encodeURIComponent(paramValues[resolved.name]))
      }
    }
    // Add query params
    const queryParams = endpoint.parameters
      .map((p: any) => p.$ref ? resolveRef(spec, p.$ref) : p)
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
      const fetchOptions: RequestInit = {
        method: endpoint.method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
      }
      if (['post', 'put', 'patch'].includes(endpoint.method) && body) {
        fetchOptions.body = body
      }

      const res = await fetch(fullUrl, fetchOptions)
      const elapsed = Date.now() - startTime

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

      setResponse({ status: res.status, statusText: res.statusText, body: resBody, time: elapsed })
    } catch (err: any) {
      setError(err.message || 'Request failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopyResponse = () => {
    if (response?.body) {
      navigator.clipboard.writeText(response.body)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const statusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-green-600 bg-green-50'
    if (status >= 400 && status < 500) return 'text-orange-600 bg-orange-50'
    if (status >= 500) return 'text-red-600 bg-red-50'
    return 'text-gray-600 bg-gray-50'
  }

  const editableParams = endpoint.parameters.map((p: any) => p.$ref ? resolveRef(spec, p.$ref) : p).filter(Boolean)

  return (
    <div className="space-y-3 bg-white rounded-lg border p-4">
      {/* URL preview */}
      <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
        <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded ${METHOD_COLORS[endpoint.method] || 'bg-gray-500'}`}>
          {endpoint.method.toUpperCase()}
        </span>
        <code className="text-xs font-mono text-gray-600 truncate flex-1">{buildUrl()}</code>
        <button
          onClick={handleSend}
          disabled={isLoading}
          className="flex items-center gap-1 px-3 py-1.5 bg-black text-white text-xs font-medium rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Send
        </button>
      </div>

      {/* Editable params */}
      {editableParams.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-gray-500 mb-1.5">Parameters</h5>
          <div className="space-y-1.5">
            {editableParams.map((param: any) => (
              <div key={param.name} className="flex items-center gap-2">
                <code className="text-xs text-gray-600 w-28 truncate">{param.name}</code>
                <span className="text-[10px] text-gray-400 w-12">{param.in}</span>
                <input
                  type="text"
                  value={paramValues[param.name] || ''}
                  onChange={(e) => setParamValues({ ...paramValues, [param.name]: e.target.value })}
                  className="flex-1 px-2 py-1 border rounded text-xs font-mono"
                  placeholder={param.schema?.type || ''}
                />
                {param.required && <span className="text-red-500 text-xs">*</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      {['post', 'put', 'patch'].includes(endpoint.method) && (
        <div>
          <h5 className="text-xs font-semibold text-gray-500 mb-1.5">Body</h5>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-xs font-mono resize-y bg-gray-50"
            rows={5}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>
      )}

      {/* Response */}
      {response && (
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${statusColor(response.status)}`}>
                {response.status} {response.statusText}
              </span>
              <span className="text-xs text-gray-400">{response.time}ms</span>
            </div>
            <button onClick={handleCopyResponse} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-3 text-xs font-mono text-gray-700 overflow-auto max-h-[400px] bg-white">
            {response.body || '(empty response)'}
          </pre>
        </div>
      )}
    </div>
  )
}

export default OpenApiRenderer
