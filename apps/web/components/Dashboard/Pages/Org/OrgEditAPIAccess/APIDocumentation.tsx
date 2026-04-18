'use client'
import React, { useState, useEffect } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import { Label } from '@components/ui/label'
import { Badge } from '@components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select'
import {
  ChevronDown,
  ChevronRight,
  Play,
  Copy,
  Check,
  RefreshCw,
  Search,
  Code,
  BookOpen,
  Monitor,
} from 'lucide-react'
import { getAPIUrl } from '@services/config/config'
import { fetchOpenAPISpec } from '@services/api_tokens/api_tokens'

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

const METHOD_COLORS: Record<string, string> = {
  get: 'bg-blue-100 text-blue-800',
  post: 'bg-green-100 text-green-800',
  put: 'bg-yellow-100 text-yellow-800',
  patch: 'bg-orange-100 text-orange-800',
  delete: 'bg-red-100 text-red-800',
}

// Tags with custom labels shown next to the group name
const TAG_LABELS: Record<string, string> = {
  admin: 'Headless',
}

// Priority order: tags listed here appear first (in this order), rest sorted alphabetically
const TAG_ORDER: string[] = ['admin']

// API tokens are restricted to these resource types only
// The tags here should match OpenAPI tags (case-insensitive)
const ALLOWED_API_TAGS = [
  'admin',
  'courses',
  'activities',
  'coursechapters',
  'chapters',
  'collections',
  'certifications',
  'usergroups',
  'user-groups',
  'payments',
  'search',
]

const APIDocumentation: React.FC = () => {
  const session = useLHSession() as any
  const org = useOrg() as any
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
  const [copiedCurl, setCopiedCurl] = useState(false)
  const [showExpectedResponses, setShowExpectedResponses] = useState(false)

  useEffect(() => {
    loadSpec()
  }, [])

  const loadSpec = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchOpenAPISpec()
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
      setError(err.message || 'Failed to load API documentation')
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

  const copyCurl = async () => {
    await navigator.clipboard.writeText(generateCurl())
    setCopiedCurl(true)
    toast.success('cURL command copied')
    setTimeout(() => setCopiedCurl(false), 2000)
  }

  const executeRequest = async () => {
    if (!selectedEndpoint) return

    setIsExecuting(true)
    setResponse(null)

    const startTime = performance.now()

    try {
      const url = buildUrl()
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
        statusText: 'Error',
        data: { error: err.message },
        time: 0,
      })
    } finally {
      setIsExecuting(false)
    }
  }

  if (loading) {
    return (
      <div className="pb-4">
        <div className="flex justify-center items-center py-12">
          <RefreshCw className="animate-spin text-gray-400 me-2" size={24} />
          <span className="text-gray-500">Loading API documentation...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="pb-4">
        <div className="text-center py-12">
          <p className="text-red-500 mb-4">{error}</p>
          <Button onClick={loadSpec} variant="outline">
            <RefreshCw size={16} className="me-2" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!spec) return null

  const groups = filterEndpoints(getEndpointGroups(spec))

  return (
    <div className="pb-4">
        {/* API Token Input */}
        <div className="mb-6">
          <Label htmlFor="apiToken" className="flex items-center gap-2 mb-2">
            <Code size={16} />
            API Token (for testing)
          </Label>
          <Input
            id="apiToken"
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="Enter your API token (lh_...)"
            className="font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">
            Enter an API token to authenticate your test requests
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Endpoints List */}
          <div className="border rounded-lg">
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <Input
                  placeholder="Search endpoints..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ps-10"
                />
              </div>
            </div>

            <div className="max-h-[600px] overflow-y-auto">
              {groups.map((group) => (
                <div key={group.tag} className="border-b last:border-b-0">
                  <button
                    onClick={() => toggleGroup(group.tag)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{group.tag}</span>
                      {TAG_LABELS[group.tag.toLowerCase()] && (
                        <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                          <Monitor size={10} className="me-1" />
                          {TAG_LABELS[group.tag.toLowerCase()]}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{group.endpoints.length}</Badge>
                      {expandedGroups.has(group.tag) ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </div>
                  </button>

                  {expandedGroups.has(group.tag) && (
                    <div className="bg-gray-50">
                      {group.endpoints.map((endpoint, idx) => (
                        <button
                          key={`${endpoint.method}-${endpoint.path}-${idx}`}
                          onClick={() =>
                            selectEndpoint(
                              endpoint.path,
                              endpoint.method,
                              spec.paths[endpoint.path][endpoint.method.toLowerCase()]
                            )
                          }
                          className={`w-full px-4 py-2 flex items-center gap-3 text-start hover:bg-gray-100 transition-colors ${
                            selectedEndpoint?.path === endpoint.path &&
                            selectedEndpoint?.method === endpoint.method
                              ? 'bg-blue-50 border-s-2 border-blue-500'
                              : ''
                          }`}
                        >
                          <Badge
                            className={`${
                              METHOD_COLORS[endpoint.method.toLowerCase()] || 'bg-gray-100'
                            } text-xs font-mono min-w-[60px] justify-center`}
                          >
                            {endpoint.method}
                          </Badge>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{endpoint.summary}</p>
                            <p className="text-xs text-gray-500 font-mono truncate">
                              {endpoint.path}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Endpoint Details & Playground */}
          <div className="border rounded-lg">
            {selectedEndpoint ? (
              <div className="flex flex-col">
                {/* Endpoint Header */}
                <div className="p-4 border-b bg-gray-50">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge
                      className={`${
                        METHOD_COLORS[selectedEndpoint.method.toLowerCase()] || 'bg-gray-100'
                      } font-mono`}
                    >
                      {selectedEndpoint.method}
                    </Badge>
                    <code className="text-sm">{selectedEndpoint.path}</code>
                  </div>
                  {selectedEndpoint.details.summary && (
                    <p className="text-sm font-medium">{selectedEndpoint.details.summary}</p>
                  )}
                  {selectedEndpoint.details.description && (
                    <p className="text-xs text-gray-600 mt-1">
                      {selectedEndpoint.details.description}
                    </p>
                  )}
                </div>

                {/* Parameters */}
                {selectedEndpoint.details.parameters &&
                  selectedEndpoint.details.parameters.length > 0 && (
                    <div className="p-4 border-b">
                      <Label className="mb-2 block">Parameters</Label>
                      <div className="space-y-2">
                        {selectedEndpoint.details.parameters.map((param: any) => (
                          <div key={param.name}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium">{param.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {param.in}
                              </Badge>
                              {param.required && (
                                <Badge variant="destructive" className="text-xs">
                                  required
                                </Badge>
                              )}
                              {param.schema?.type && (
                                <span className="text-xs text-gray-400">{param.schema.type}</span>
                              )}
                            </div>
                            {param.description && (
                              <p className="text-xs text-gray-500 mb-1">{param.description}</p>
                            )}
                            <Input
                              value={requestParams[param.name] || ''}
                              onChange={(e) =>
                                setRequestParams({
                                  ...requestParams,
                                  [param.name]: e.target.value,
                                })
                              }
                              placeholder={param.description || param.name}
                              className="text-sm"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Request Body */}
                {selectedEndpoint.method !== 'GET' && (
                  <div className="p-4 border-b">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="block">Request Body (JSON)</Label>
                      {selectedEndpoint.details.requestBody?.content?.['application/json']?.schema && (
                        <span className="text-xs text-gray-400 font-mono">
                          {getSchemaTypeLabel(selectedEndpoint.details.requestBody.content['application/json'].schema)}
                        </span>
                      )}
                    </div>
                    {/* Show expected body schema */}
                    {selectedEndpoint.details.requestBody?.content?.['application/json']?.schema && (() => {
                      const bodySchema = resolveRef(selectedEndpoint.details.requestBody.content['application/json'].schema)
                      if (bodySchema?.properties) {
                        return (
                          <div className="mb-2 bg-gray-50 rounded-md p-2 text-xs space-y-0.5">
                            {Object.entries(bodySchema.properties).map(([key, prop]: [string, any]) => {
                              const resolvedProp = resolveRef(prop)
                              const isRequired = bodySchema.required?.includes(key)
                              return (
                                <div key={key} className="flex items-center gap-2">
                                  <code className="text-gray-700">{key}</code>
                                  <span className="text-gray-400">{resolvedProp?.type || 'any'}</span>
                                  {isRequired && <span className="text-red-400">*</span>}
                                  {resolvedProp?.description && (
                                    <span className="text-gray-400 truncate">- {resolvedProp.description}</span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      }
                      return null
                    })()}
                    <Textarea
                      value={requestBody}
                      onChange={(e) => setRequestBody(e.target.value)}
                      placeholder="{}"
                      className="font-mono text-sm min-h-[120px]"
                    />
                  </div>
                )}

                {/* Actions */}
                <div className="p-4 border-b flex gap-2">
                  <Button
                    onClick={executeRequest}
                    disabled={isExecuting}
                    className="flex-1"
                  >
                    {isExecuting ? (
                      <>
                        <RefreshCw size={16} className="me-2 animate-spin" />
                        Executing...
                      </>
                    ) : (
                      <>
                        <Play size={16} className="me-2" />
                        Send Request
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={copyCurl}>
                    {copiedCurl ? (
                      <Check size={16} className="text-green-600" />
                    ) : (
                      <Copy size={16} />
                    )}
                  </Button>
                </div>

                {/* Response */}
                <div className="p-4 border-b">
                  <Label className="mb-2 block">Response</Label>
                  {response ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge
                          className={
                            response.status >= 200 && response.status < 300
                              ? 'bg-green-100 text-green-800'
                              : response.status >= 400
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }
                        >
                          {response.status} {response.statusText}
                        </Badge>
                        <span className="text-xs text-gray-500">{response.time}ms</span>
                      </div>
                      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-auto max-h-[300px]">
                        {typeof response.data === 'object'
                          ? JSON.stringify(response.data, null, 2)
                          : response.data}
                      </pre>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-400">
                      <BookOpen size={24} className="mx-auto mb-1 opacity-50" />
                      <p className="text-sm">Send a request to see the response</p>
                    </div>
                  )}
                </div>

                {/* Expected Responses (collapsible) */}
                {selectedEndpoint.details.responses && (
                  <div className="border-b">
                    <button
                      onClick={() => setShowExpectedResponses(!showExpectedResponses)}
                      className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <Label className="cursor-pointer text-gray-500">Expected Responses</Label>
                      <div className="flex items-center gap-1.5">
                        {Object.keys(selectedEndpoint.details.responses).map((code) => (
                          <Badge
                            key={code}
                            variant="outline"
                            className={`text-xs ${
                              code.startsWith('2')
                                ? 'border-green-200 text-green-600'
                                : code.startsWith('4')
                                ? 'border-red-200 text-red-600'
                                : 'border-gray-200 text-gray-500'
                            }`}
                          >
                            {code}
                          </Badge>
                        ))}
                        {showExpectedResponses ? (
                          <ChevronDown size={14} className="text-gray-400 ms-1" />
                        ) : (
                          <ChevronRight size={14} className="text-gray-400 ms-1" />
                        )}
                      </div>
                    </button>

                    {showExpectedResponses && (
                      <div className="px-4 pb-4 space-y-2">
                        {Object.entries(selectedEndpoint.details.responses).map(([code, res]: [string, any]) => {
                          const responseSchema = res?.content?.['application/json']?.schema
                          const resolvedSchema = responseSchema ? resolveRef(responseSchema) : null
                          const example = resolvedSchema ? schemaToExample(resolvedSchema) : null

                          return (
                            <div key={code} className="border rounded-md overflow-hidden">
                              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50">
                                <Badge
                                  className={`text-xs ${
                                    code.startsWith('2')
                                      ? 'bg-green-100 text-green-800'
                                      : code.startsWith('4')
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-gray-100 text-gray-800'
                                  }`}
                                >
                                  {code}
                                </Badge>
                                <span className="text-xs text-gray-600">{res.description || ''}</span>
                                {responseSchema && (
                                  <span className="text-xs text-gray-400 font-mono ms-auto">
                                    {getSchemaTypeLabel(responseSchema)}
                                  </span>
                                )}
                              </div>
                              {example && (
                                <pre className="bg-gray-900 text-gray-100 p-3 text-xs overflow-auto max-h-[150px]">
                                  {JSON.stringify(example, null, 2)}
                                </pre>
                              )}
                              {!example && resolvedSchema?.properties && (
                                <div className="px-3 py-2 text-xs space-y-0.5">
                                  {Object.entries(resolvedSchema.properties).map(([key, prop]: [string, any]) => {
                                    const resolvedProp = resolveRef(prop)
                                    return (
                                      <div key={key} className="flex items-center gap-2">
                                        <code className="text-gray-700">{key}</code>
                                        <span className="text-gray-400">{resolvedProp?.type || 'any'}</span>
                                        {resolvedProp?.description && (
                                          <span className="text-gray-400 truncate">- {resolvedProp.description}</span>
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
              <div className="flex items-center justify-center h-full py-12 text-gray-400">
                <div className="text-center">
                  <Code size={48} className="mx-auto mb-4 opacity-50" />
                  <p>Select an endpoint to view details</p>
                  <p className="text-sm">and test API calls</p>
                </div>
              </div>
            )}
          </div>
        </div>
    </div>
  )
}

export default APIDocumentation
