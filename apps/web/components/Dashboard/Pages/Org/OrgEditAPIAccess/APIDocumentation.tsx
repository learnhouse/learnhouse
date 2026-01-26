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

// API tokens are restricted to these resource types only
// The tags here should match OpenAPI tags (case-insensitive)
const ALLOWED_API_TAGS = [
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

  useEffect(() => {
    loadSpec()
  }, [])

  const loadSpec = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchOpenAPISpec()
      setSpec(data)
      // Expand first group by default
      if (data.paths) {
        const firstTag = getEndpointGroups(data)[0]?.tag
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
      .sort((a, b) => a.tag.localeCompare(b.tag))
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

    // Pre-fill path parameters with org_id if available
    if (details.parameters) {
      const params: Record<string, string> = {}
      details.parameters.forEach((param: any) => {
        if (param.name === 'org_id' && org?.id) {
          params[param.name] = String(org.id)
        } else {
          params[param.name] = ''
        }
      })
      setRequestParams(params)
    }

    // Pre-fill request body with example if available
    if (details.requestBody?.content?.['application/json']?.schema) {
      const schema = details.requestBody.content['application/json'].schema
      if (schema.example) {
        setRequestBody(JSON.stringify(schema.example, null, 2))
      } else if (schema.properties) {
        const example: Record<string, any> = {}
        Object.entries(schema.properties).forEach(([key, prop]: [string, any]) => {
          if (prop.example !== undefined) {
            example[key] = prop.example
          } else if (prop.type === 'string') {
            example[key] = ''
          } else if (prop.type === 'number' || prop.type === 'integer') {
            example[key] = 0
          } else if (prop.type === 'boolean') {
            example[key] = false
          } else if (prop.type === 'array') {
            example[key] = []
          } else if (prop.type === 'object') {
            example[key] = {}
          }
        })
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
          <RefreshCw className="animate-spin text-gray-400 mr-2" size={24} />
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
            <RefreshCw size={16} className="mr-2" />
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <Input
                  placeholder="Search endpoints..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
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
                    <span className="font-medium capitalize">{group.tag}</span>
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
                          className={`w-full px-4 py-2 flex items-center gap-3 text-left hover:bg-gray-100 transition-colors ${
                            selectedEndpoint?.path === endpoint.path &&
                            selectedEndpoint?.method === endpoint.method
                              ? 'bg-blue-50 border-l-2 border-blue-500'
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
              <div className="flex flex-col h-full">
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
                            </div>
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
                    <Label className="mb-2 block">Request Body (JSON)</Label>
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
                        <RefreshCw size={16} className="mr-2 animate-spin" />
                        Executing...
                      </>
                    ) : (
                      <>
                        <Play size={16} className="mr-2" />
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
                <div className="flex-1 p-4 overflow-auto">
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
                    <div className="text-center py-8 text-gray-400">
                      <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Send a request to see the response</p>
                    </div>
                  )}
                </div>
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
