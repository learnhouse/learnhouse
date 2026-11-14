'use client'
import React, { useState, useEffect } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'
import {
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  Code,
  Desktop,
  Key,
  PaperPlaneTilt,
  Warning,
} from '@phosphor-icons/react'
import { getAPIUrl } from '@services/config/config'
import { fetchOpenAPISpec } from '@services/api_tokens/api_tokens'
import { Button, Chip, EmptyState, INPUT, SearchInput, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { CodeBlock, Kbd, MethodBadge, StatusCode } from '@components/Dashboard/Pages/Org/Developers/devKit'

interface OpenAPIPath {
  [method: string]: {
    summary?: string
    description?: string
    tags?: string[]
    parameters?: Array<{
      name: string
      in: string
      required?: boolean
      schema?: any
      description?: string
    }>
    requestBody?: {
      content?: {
        'application/json'?: {
          schema?: any
        }
      }
    }
    responses?: {
      [code: string]: {
        description?: string
        content?: any
      }
    }
  }
}

interface OpenAPISpec {
  openapi: string
  info: {
    title: string
    version: string
    description?: string
  }
  paths: {
    [path: string]: OpenAPIPath
  }
  components?: {
    schemas?: {
      [name: string]: any
    }
  }
}

interface EndpointGroup {
  tag: string
  endpoints: Array<{
    path: string
    method: string
    summary: string
    description?: string
    parameters?: any[]
    requestBody?: any
    responses?: any
  }>
}

// Tags with custom labels shown next to the group name
const TAG_LABELS: Record<string, string> = {
  admin: 'dashboard.organization.api_access.docs.tag_headless',
}

// Priority order: tags listed here appear first (in this order), rest sorted alphabetically
const TAG_ORDER: string[] = ['admin']

// API tokens are restricted to these resource types only
// The tags here should match OpenAPI tags (case-insensitive)
const ALLOWED_API_TAGS = [
  'admin',
  'courses',
  'activities',
  'assignments',
  'coursechapters',
  'chapters',
  'folders',
  'media',
  'certifications',
  'usergroups',
  'user-groups',
  'payments',
  'search',
  // Plays authoring API (EE, Pro and up); absent from the spec without EE.
  'plays',
  // Newsletter API (EE, Standard and up): lists, subscribers, segments,
  // campaigns, automations. Absent from the spec without EE.
  'newsletter',
  // CRM integrations (EE): status, mapping, syncs. Absent without EE.
  'crm',
]

const APIDocumentation: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const accessToken = session?.data?.tokens?.access_token
  const [spec, setSpec] = useState<OpenAPISpec | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [selectedEndpoint, setSelectedEndpoint] = useState<{
    path: string
    method: string
    details: any
  } | null>(null)

  // Playground state
  const [apiToken, setApiToken] = useState('')
  const [requestParams, setRequestParams] = useState<Record<string, string>>({})
  const [requestBody, setRequestBody] = useState('')
  const [response, setResponse] = useState<{
    status: number
    statusText: string
    data: any
    time: number
  } | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [showExpectedResponses, setShowExpectedResponses] = useState(false)

  useEffect(() => {
    if (org?.id && accessToken) {
      loadSpec()
    }
  }, [org?.id, accessToken])

  const loadSpec = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchOpenAPISpec(org.id, accessToken)
      setSpec(data)
      // Expand admin group by default if it exists, otherwise first group
      if (data.paths) {
        const groups = getEndpointGroups(data)
        const adminGroup = groups.find((g) => g.tag === 'admin')
        const firstTag = adminGroup?.tag || groups[0]?.tag
        if (firstTag) {
          setExpandedGroups(new Set([firstTag]))
        }
      }
    } catch (err: any) {
      setError(err.message || t('dashboard.organization.api_access.docs.load_failed'))
    } finally {
      setLoading(false)
    }
  }

  /**
   * Resolve a $ref pointer like "#/components/schemas/Foo" to the actual schema object.
   * Returns the resolved schema, or the input if no $ref is found.
   */
  const resolveRef = (schema: any, depth: number = 0): any => {
    if (!schema || !spec || depth > 8) return schema

    if (schema.$ref) {
      const refPath = schema.$ref.replace('#/', '').split('/')
      let resolved: any = spec
      for (const part of refPath) {
        resolved = resolved?.[part]
      }
      return resolveRef(resolved, depth + 1)
    }

    // Resolve allOf by merging
    if (schema.allOf) {
      const merged: any = { type: 'object', properties: {}, required: [] }
      for (const sub of schema.allOf) {
        const resolved = resolveRef(sub, depth + 1)
        if (resolved?.properties) {
          Object.assign(merged.properties, resolved.properties)
        }
        if (resolved?.required) {
          merged.required.push(...resolved.required)
        }
      }
      return merged
    }

    // Resolve items in arrays
    if (schema.type === 'array' && schema.items) {
      return { ...schema, items: resolveRef(schema.items, depth + 1) }
    }

    return schema
  }

  /**
   * Build a human-readable representation of a schema for display.
   */
  const schemaToExample = (schema: any, depth: number = 0): any => {
    if (!schema || depth > 5) return null
    const resolved = resolveRef(schema, 0)
    if (!resolved) return null

    if (resolved.example !== undefined) return resolved.example

    if (resolved.type === 'object' || resolved.properties) {
      const obj: Record<string, any> = {}
      Object.entries(resolved.properties || {}).forEach(([key, prop]: [string, any]) => {
        const resolvedProp = resolveRef(prop, 0)
        if (resolvedProp?.example !== undefined) {
          obj[key] = resolvedProp.example
        } else if (resolvedProp?.type === 'string') {
          obj[key] = resolvedProp.description || 'string'
        } else if (resolvedProp?.type === 'integer' || resolvedProp?.type === 'number') {
          obj[key] = 0
        } else if (resolvedProp?.type === 'boolean') {
          obj[key] = false
        } else if (resolvedProp?.type === 'array') {
          obj[key] = [schemaToExample(resolvedProp.items, depth + 1) || '...']
        } else if (resolvedProp?.type === 'object' || resolvedProp?.properties) {
          obj[key] = schemaToExample(resolvedProp, depth + 1) || {}
        } else {
          obj[key] = null
        }
      })
      return obj
    }

    if (resolved.type === 'array') {
      return [schemaToExample(resolved.items, depth + 1) || '...']
    }

    if (resolved.type === 'string') return 'string'
    if (resolved.type === 'integer' || resolved.type === 'number') return 0
    if (resolved.type === 'boolean') return false

    return null
  }

  /**
   * Get a short type label from a schema for display.
   */
  const getSchemaTypeLabel = (schema: any): string => {
    if (!schema) return ''
    const resolved = resolveRef(schema, 0)
    if (!resolved) return ''

    if (resolved.title) return resolved.title

    if (schema.$ref) {
      const parts = schema.$ref.split('/')
      return parts[parts.length - 1]
    }

    if (resolved.type === 'array') {
      const itemLabel = resolved.items?.$ref
        ? resolved.items.$ref.split('/').pop()
        : resolved.items?.title || resolved.items?.type || 'item'
      return `${itemLabel}[]`
    }

    return resolved.type || 'object'
  }

  const getEndpointGroups = (specData: OpenAPISpec): EndpointGroup[] => {
    const groups: Record<string, EndpointGroup['endpoints']> = {}

    // Helper to check if a tag is allowed for API tokens
    const isAllowedTag = (tag: string): boolean => {
      // Tool endpoints (POST /api/v1/tools/{name}) are tagged "tools/<toolset>".
      if (tag === 'tools' || tag.startsWith('tools/')) return true
      const normalizedTag = tag.toLowerCase().replace(/[^a-z]/g, '')
      return ALLOWED_API_TAGS.some(
        (allowed) => normalizedTag === allowed.toLowerCase().replace(/[^a-z]/g, '')
      )
    }

    Object.entries(specData.paths || {}).forEach(([path, methods]) => {
      Object.entries(methods).forEach(([method, details]) => {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
          const tag = details.tags?.[0] || 'Other'

          // Only include endpoints with allowed tags
          if (!isAllowedTag(tag)) {
            return
          }

          if (!groups[tag]) {
            groups[tag] = []
          }
          groups[tag].push({
            path,
            method: method.toUpperCase(),
            summary: details.summary || path,
            description: details.description,
            parameters: details.parameters,
            requestBody: details.requestBody,
            responses: details.responses,
          })
        }
      })
    })

    return Object.entries(groups)
      .map(([tag, endpoints]) => ({ tag, endpoints }))
      .sort((a, b) => {
        const aIdx = TAG_ORDER.indexOf(a.tag.toLowerCase())
        const bIdx = TAG_ORDER.indexOf(b.tag.toLowerCase())
        // Priority tags come first
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
        if (aIdx !== -1) return -1
        if (bIdx !== -1) return 1
        // Rest sorted alphabetically
        return a.tag.localeCompare(b.tag)
      })
  }

  const filterEndpoints = (groups: EndpointGroup[]): EndpointGroup[] => {
    if (!searchQuery.trim()) return groups

    const query = searchQuery.toLowerCase()
    return groups
      .map((group) => ({
        ...group,
        endpoints: group.endpoints.filter(
          (ep) =>
            ep.path.toLowerCase().includes(query) ||
            ep.summary.toLowerCase().includes(query) ||
            ep.method.toLowerCase().includes(query) ||
            group.tag.toLowerCase().includes(query)
        ),
      }))
      .filter((group) => group.endpoints.length > 0)
  }

  const toggleGroup = (tag: string) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(tag)) {
      newExpanded.delete(tag)
    } else {
      newExpanded.add(tag)
    }
    setExpandedGroups(newExpanded)
  }

  const selectEndpoint = (path: string, method: string, details: any) => {
    setSelectedEndpoint({ path, method, details })
    setRequestParams({})
    setRequestBody('')
    setResponse(null)
    setShowExpectedResponses(false)

    // Pre-fill path parameters with org_id or org_slug if available
    if (details.parameters) {
      const params: Record<string, string> = {}
      details.parameters.forEach((param: any) => {
        if (param.name === 'org_id' && org?.id) {
          params[param.name] = String(org.id)
        } else if (param.name === 'org_slug' && org?.slug) {
          params[param.name] = String(org.slug)
        } else {
          params[param.name] = ''
        }
      })
      setRequestParams(params)
    }

    // Pre-fill request body with example from schema
    if (details.requestBody?.content?.['application/json']?.schema) {
      const schema = details.requestBody.content['application/json'].schema
      const example = schemaToExample(schema)
      if (example) {
        setRequestBody(JSON.stringify(example, null, 2))
      }
    }
  }

  const buildUrl = (): string => {
    if (!selectedEndpoint) return ''

    let url = selectedEndpoint.path
    const queryParams: string[] = []

    // Replace path parameters
    Object.entries(requestParams).forEach(([key, value]) => {
      const param = selectedEndpoint.details.parameters?.find((p: any) => p.name === key)
      if (param?.in === 'path') {
        url = url.replace(`{${key}}`, encodeURIComponent(value))
      } else if (param?.in === 'query' && value) {
        queryParams.push(`${key}=${encodeURIComponent(value)}`)
      }
    })

    // Strip /api/v1 prefix from OpenAPI path since getAPIUrl() already includes it
    if (url.startsWith('/api/v1/')) {
      url = url.slice(7) // Remove '/api/v1' (keep the trailing slash)
    } else if (url.startsWith('/api/v1')) {
      url = url.slice(7) || '/'
    }

    const baseUrl = getAPIUrl()
    const fullUrl = `${baseUrl}${url.startsWith('/') ? url.slice(1) : url}`

    return queryParams.length > 0 ? `${fullUrl}?${queryParams.join('&')}` : fullUrl
  }

  const generateCurl = (): string => {
    if (!selectedEndpoint) return ''

    const url = buildUrl()
    let curl = `curl -X ${selectedEndpoint.method} '${url}'`

    if (apiToken && apiToken.trim()) {
      curl += ` \\\n  -H 'Authorization: Bearer ${apiToken.trim()}'`
    }

    if (selectedEndpoint.method !== 'GET' && requestBody.trim()) {
      curl += ` \\\n  -H 'Content-Type: application/json'`
      curl += ` \\\n  -d '${requestBody.replace(/\n/g, '')}'`
    }

    return curl
  }

  const executeRequest = async () => {
    if (!selectedEndpoint) return

    setIsExecuting(true)
    setResponse(null)

    const startTime = performance.now()

    try {
      const url = buildUrl()
      // eslint-disable-next-line no-undef -- RequestInit is a DOM lib type
      const options: RequestInit = {
        method: selectedEndpoint.method,
        headers: {
          'Content-Type': 'application/json',
        },
        // Don't send cookies - we want to test with API token only
        credentials: 'omit',
      }

      if (apiToken && apiToken.trim()) {
        options.headers = {
          ...options.headers,
          Authorization: `Bearer ${apiToken.trim()}`,
        }
      }

      if (selectedEndpoint.method !== 'GET' && requestBody.trim()) {
        options.body = requestBody
      }

      const res = await fetch(url, options)
      const endTime = performance.now()

      let data
      const contentType = res.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        data = await res.json()
      } else {
        data = await res.text()
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        data,
        time: Math.round(endTime - startTime),
      })
    } catch (err: any) {
      setResponse({
        status: 0,
        statusText: t('dashboard.organization.api_access.docs.error'),
        data: { error: err.message },
        time: 0,
      })
    } finally {
      setIsExecuting(false)
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 animate-pulse" aria-busy>
        <div className="bg-white rounded-2xl nice-shadow p-4 space-y-3">
          <div className="h-9 bg-neutral-100 rounded-lg" />
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-5 w-12 bg-neutral-100 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-neutral-100 rounded w-2/3" />
                <div className="h-2.5 bg-neutral-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-2xl nice-shadow p-5 space-y-3">
          <div className="h-5 bg-neutral-100 rounded w-1/2" />
          <div className="h-3 bg-neutral-100 rounded w-3/4" />
          <div className="h-32 bg-neutral-100 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl nice-shadow">
        <EmptyState
          icon={<Warning size={22} />}
          title={t('dashboard.organization.api_access.docs.load_failed')}
          description={error}
          action={
            <Button onClick={loadSpec} icon={<ArrowsClockwise size={14} />}>
              {t('common.retry')}
            </Button>
          }
        />
      </div>
    )
  }

  if (!spec) return null

  const groups = filterEndpoints(getEndpointGroups(spec))
  const bodySchemaRaw = selectedEndpoint?.details.requestBody?.content?.['application/json']?.schema
  const bodySchema = bodySchemaRaw ? resolveRef(bodySchemaRaw) : null
  const params: any[] = Array.isArray(selectedEndpoint?.details.parameters) ? selectedEndpoint!.details.parameters : []
  const responseText = response
    ? typeof response.data === 'object'
      ? JSON.stringify(response.data, null, 2)
      : String(response.data)
    : ''

  return (
    <div className="flex flex-col gap-4">
      {/* Test token */}
      <div className="bg-white rounded-2xl nice-shadow px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3 min-w-0 sm:w-80 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-neutral-100 text-neutral-600 flex items-center justify-center shrink-0">
            <Key size={17} />
          </div>
          <div className="min-w-0">
            <label htmlFor="apiToken" className="block text-sm font-semibold text-neutral-900">
              {t('dashboard.organization.api_access.docs.token_label')}
            </label>
            <p className="text-xs text-neutral-500 truncate">{t('dashboard.organization.api_access.docs.token_hint')}</p>
          </div>
        </div>
        <input
          id="apiToken"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder={t('dashboard.organization.api_access.docs.token_placeholder')}
          className={`${INPUT} font-mono text-[13px] flex-1`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 items-start">
        {/* Endpoints */}
        <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
          <div className="p-3 border-b border-neutral-100">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('dashboard.organization.api_access.docs.search_placeholder')}
            />
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {groups.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-neutral-400">{t('dashboard.developers.api.no_endpoints')}</p>
            )}
            {groups.map((group) => {
              const open = expandedGroups.has(group.tag) || !!searchQuery.trim()
              return (
                <div key={group.tag} className="border-b border-neutral-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.tag)}
                    aria-expanded={open}
                    className="w-full px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-neutral-50/70 transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {open ? (
                        <CaretDown size={13} className="text-neutral-400 shrink-0" />
                      ) : (
                        <CaretRight size={13} className="text-neutral-400 shrink-0 rtl:rotate-180" />
                      )}
                      <span className="text-sm font-semibold text-neutral-800 capitalize truncate">{group.tag}</span>
                      {TAG_LABELS[group.tag.toLowerCase()] && (
                        <Chip tone="violet" icon={<Desktop size={11} />}>
                          {t(TAG_LABELS[group.tag.toLowerCase()])}
                        </Chip>
                      )}
                    </span>
                    <span className="text-xs font-semibold text-neutral-400 tabular-nums">{group.endpoints.length}</span>
                  </button>

                  {open && (
                    <div className="pb-1.5">
                      {group.endpoints.map((endpoint, idx) => {
                        const active =
                          selectedEndpoint?.path === endpoint.path && selectedEndpoint?.method === endpoint.method
                        return (
                          <button
                            type="button"
                            key={`${endpoint.method}-${endpoint.path}-${idx}`}
                            onClick={() =>
                              selectEndpoint(
                                endpoint.path,
                                endpoint.method,
                                spec.paths[endpoint.path][endpoint.method.toLowerCase()]
                              )
                            }
                            className={`w-full ps-4 pe-3 py-2 flex items-center gap-3 text-start transition-colors border-s-2 ${
                              active
                                ? 'bg-neutral-100/80 border-neutral-900'
                                : 'border-transparent hover:bg-neutral-50'
                            }`}
                          >
                            <MethodBadge method={endpoint.method} />
                            <span className="flex-1 min-w-0">
                              <span className={`block text-[13px] truncate ${active ? 'font-semibold text-neutral-900' : 'font-medium text-neutral-700'}`}>
                                {endpoint.summary}
                              </span>
                              <code dir="ltr" className="block text-[11px] text-neutral-400 font-mono truncate">
                                {endpoint.path}
                              </code>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Endpoint details & playground */}
        <div className="bg-white rounded-2xl nice-shadow overflow-hidden xl:sticky xl:top-0">
          {selectedEndpoint ? (
            <div className="flex flex-col divide-y divide-neutral-100">
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 min-w-0">
                  <MethodBadge method={selectedEndpoint.method} />
                  <code dir="ltr" className="text-[13px] font-mono font-medium text-neutral-800 truncate">
                    {selectedEndpoint.path}
                  </code>
                </div>
                {selectedEndpoint.details.summary && (
                  <p className="mt-2 text-sm font-semibold text-neutral-900">{selectedEndpoint.details.summary}</p>
                )}
                {selectedEndpoint.details.description && (
                  <p className="mt-1 text-xs text-neutral-500 whitespace-pre-line">{selectedEndpoint.details.description}</p>
                )}
              </div>

              {params.length > 0 && (
                <div className="px-5 py-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-3">
                    {t('dashboard.organization.api_access.docs.parameters')}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {params.map((param: any) => (
                      <label key={`${param.in}-${param.name}`} className="block min-w-0">
                        <span className="flex items-center gap-1.5 mb-1.5 min-w-0">
                          <code className="text-[12.5px] font-mono font-semibold text-neutral-800 truncate">{param.name}</code>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{param.in}</span>
                          {param.schema?.type && (
                            <span className="text-[11px] font-mono text-neutral-400">{param.schema.type}</span>
                          )}
                          {param.required && (
                            <span className="text-[10px] font-semibold text-rose-500">
                              {t('dashboard.organization.api_access.docs.required')}
                            </span>
                          )}
                        </span>
                        <input
                          value={requestParams[param.name] || ''}
                          onChange={(e) =>
                            setRequestParams({
                              ...requestParams,
                              [param.name]: e.target.value,
                            })
                          }
                          placeholder={param.description || param.name}
                          className={`${INPUT} font-mono text-[13px]`}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {selectedEndpoint.method !== 'GET' && (
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      {t('dashboard.organization.api_access.docs.request_body')}
                    </h4>
                    {bodySchemaRaw && (
                      <span className="text-[11px] text-neutral-400 font-mono">{getSchemaTypeLabel(bodySchemaRaw)}</span>
                    )}
                  </div>
                  {bodySchema?.properties && (
                    <div className="mb-2 rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 px-3 py-2 text-xs space-y-1">
                      {Object.entries(bodySchema.properties).map(([key, prop]: [string, any]) => {
                        const resolvedProp = resolveRef(prop)
                        const isRequired = bodySchema.required?.includes(key)
                        return (
                          <div key={key} className="flex items-center gap-2 min-w-0">
                            <code className="font-mono text-neutral-800">{key}</code>
                            <span className="font-mono text-neutral-400">{resolvedProp?.type || 'any'}</span>
                            {isRequired && <span className="text-rose-500">*</span>}
                            {resolvedProp?.description && (
                              <span className="text-neutral-400 truncate">{resolvedProp.description}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <textarea
                    value={requestBody}
                    onChange={(e) => setRequestBody(e.target.value)}
                    placeholder="{}"
                    spellCheck={false}
                    dir="ltr"
                    className={`${TEXTAREA} font-mono text-[12.5px] min-h-[140px] resize-y`}
                  />
                </div>
              )}

              <div className="px-5 py-4 flex flex-col gap-3">
                <CodeBlock title="cURL" tabs={[{ key: 'curl', label: 'request.sh', code: generateCurl(), lang: 'bash' }]} maxHeight="max-h-[180px]" />
                <div className="flex items-center gap-3">
                  <Button
                    variant="primary"
                    onClick={executeRequest}
                    loading={isExecuting}
                    icon={<PaperPlaneTilt size={14} />}
                  >
                    {isExecuting
                      ? t('dashboard.organization.api_access.docs.executing')
                      : t('dashboard.organization.api_access.docs.send_request')}
                  </Button>
                  {!apiToken.trim() && (
                    <span className="text-xs text-amber-700">{t('dashboard.developers.api.no_token_warning')}</span>
                  )}
                </div>
              </div>

              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    {t('dashboard.organization.api_access.docs.response')}
                  </h4>
                  {response && (
                    <span className="flex items-center gap-2">
                      <StatusCode code={response.status}>{response.statusText}</StatusCode>
                      <span className="text-[11px] font-mono text-neutral-400 tabular-nums">{response.time}ms</span>
                    </span>
                  )}
                </div>
                {response ? (
                  <CodeBlock
                    title="response.json"
                    tabs={[{ key: 'res', label: 'response.json', code: responseText, lang: typeof response.data === 'object' ? 'json' : 'text' }]}
                    maxHeight="max-h-[340px]"
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-neutral-200 py-8 text-center">
                    <p className="text-sm text-neutral-400">{t('dashboard.organization.api_access.docs.no_response')}</p>
                  </div>
                )}
              </div>

              {selectedEndpoint.details.responses && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowExpectedResponses(!showExpectedResponses)}
                    aria-expanded={showExpectedResponses}
                    className="w-full px-5 py-3 flex items-center justify-between gap-3 hover:bg-neutral-50/70 transition-colors"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      {t('dashboard.organization.api_access.docs.expected_responses')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {Object.keys(selectedEndpoint.details.responses).map((code) => (
                        <StatusCode key={code} code={code} />
                      ))}
                      {showExpectedResponses ? (
                        <CaretDown size={13} className="text-neutral-400 ms-1" />
                      ) : (
                        <CaretRight size={13} className="text-neutral-400 ms-1 rtl:rotate-180" />
                      )}
                    </span>
                  </button>

                  {showExpectedResponses && (
                    <div className="px-5 pb-4 space-y-3">
                      {Object.entries(selectedEndpoint.details.responses).map(([code, res]: [string, any]) => {
                        const responseSchema = res?.content?.['application/json']?.schema
                        const resolvedSchema = responseSchema ? resolveRef(responseSchema) : null
                        const example = resolvedSchema ? schemaToExample(resolvedSchema) : null

                        return (
                          <div key={code} className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <StatusCode code={code} />
                              <span className="text-xs text-neutral-600 truncate">{res?.description || ''}</span>
                              {responseSchema && (
                                <span className="text-[11px] text-neutral-400 font-mono ms-auto shrink-0">
                                  {getSchemaTypeLabel(responseSchema)}
                                </span>
                              )}
                            </div>
                            {example && (
                              <CodeBlock
                                title={`${code}.json`}
                                tabs={[{ key: code, label: `${code}.json`, code: JSON.stringify(example, null, 2), lang: 'json' }]}
                                maxHeight="max-h-[180px]"
                              />
                            )}
                            {!example && resolvedSchema?.properties && (
                              <div className="rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 px-3 py-2 text-xs space-y-1">
                                {Object.entries(resolvedSchema.properties).map(([key, prop]: [string, any]) => {
                                  const resolvedProp = resolveRef(prop)
                                  return (
                                    <div key={key} className="flex items-center gap-2 min-w-0">
                                      <code className="font-mono text-neutral-800">{key}</code>
                                      <span className="font-mono text-neutral-400">{resolvedProp?.type || 'any'}</span>
                                      {resolvedProp?.description && (
                                        <span className="text-neutral-400 truncate">{resolvedProp.description}</span>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={<Code size={22} />}
              title={t('dashboard.organization.api_access.docs.select_endpoint')}
              description={t('dashboard.developers.api.select_endpoint_hint')}
              action={
                <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <Kbd>/</Kbd>
                  {t('dashboard.developers.api.search_hint')}
                </span>
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default APIDocumentation
