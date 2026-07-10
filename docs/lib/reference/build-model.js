import { API_BASE_URL, API_GROUPS, groupForTag, groupBySlug, METHOD_TO_ACTION } from './config'
import {
  resolveRef,
  simplifyAnyOf,
  schemaToExample,
  schemaFields,
  typeLabel,
  isBinaryField,
} from './resolve'
import { buildSnippets } from './snippets'
import { highlight } from './highlight'

const METHODS = ['get', 'post', 'put', 'patch', 'delete']

const CONTENT_TYPE_PRIORITY = [
  'application/json',
  'multipart/form-data',
  'application/x-www-form-urlencoded',
]

/** Operations that must not show a bearer header (they produce credentials). */
const NO_AUTH_OPERATIONS = new Set(['POST /api/v1/auth/login'])

function operationId(method, path) {
  const trimmed = path.replace(/^\/api\/v1/, '') || '/'
  return `${method.toLowerCase()}${trimmed}`
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/** Collect documented operations grouped by API_GROUPS slug, preserving spec order. */
function collectByGroup(spec) {
  const byGroup = new Map(API_GROUPS.map((g) => [g.slug, []]))

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const method of METHODS) {
      const op = methods?.[method]
      if (!op) continue
      const tag = op.tags?.[0]
      if (!tag) continue
      const group = groupForTag(tag)
      if (!group) continue
      byGroup.get(group.slug).push({ path, method: method.toUpperCase(), op })
    }
  }

  for (const group of API_GROUPS) {
    if (byGroup.get(group.slug).length === 0) {
      console.warn(`[reference] group "${group.slug}" matched zero operations — spec drift?`)
    }
  }

  return byGroup
}

/** Small nav payload for the sidebar (sent to the client). */
export function buildNavIndex(spec) {
  const byGroup = collectByGroup(spec)
  return {
    baseUrl: API_BASE_URL,
    groups: API_GROUPS.map((group) => ({
      slug: group.slug,
      title: group.title,
      operations: byGroup.get(group.slug).map(({ path, method, op }) => ({
        id: operationId(method, path),
        method,
        path,
        summary: op.summary || path,
      })),
    })).filter((g) => g.operations.length > 0),
  }
}

function paramRows(spec, parameters, location) {
  return (parameters || [])
    .map((p) => resolveRef(spec, p))
    .filter((p) => p && p.in === location)
    .map((p) => {
      const schema = simplifyAnyOf(spec, p.schema || {})
      return {
        name: p.name,
        type: typeLabel(spec, p.schema || {}),
        required: !!p.required,
        nullable: !!schema?.nullable,
        description: p.description || schema?.description || '',
        enumValues: schema?.enum || null,
        children: [],
        example: schemaToExample(spec, p.schema || {}, 0, p.name),
      }
    })
}

function pickContentType(content) {
  if (!content) return null
  for (const type of CONTENT_TYPE_PRIORITY) {
    if (content[type]) return type
  }
  return Object.keys(content)[0] || null
}

function requestBodyModel(spec, op) {
  const body = op.requestBody && resolveRef(spec, op.requestBody)
  if (!body?.content) return null
  const contentType = pickContentType(body.content)
  if (!contentType) return null
  const schema = body.content[contentType]?.schema
  if (!schema) return null

  const resolved = resolveRef(spec, schema)
  const fields = schemaFields(spec, schema)
  const example = schemaToExample(spec, schema) ?? {}
  const fieldSchemas = Object.entries(resolved?.properties || {}).map(([name, s]) => ({
    name,
    schema: simplifyAnyOf(spec, s),
  }))

  return {
    contentType,
    required: !!body.required,
    typeLabel: typeLabel(spec, schema),
    fields,
    example,
    fieldSchemas,
  }
}

async function responseModels(spec, op) {
  const out = []
  for (const [status, rawResponse] of Object.entries(op.responses || {})) {
    const response = resolveRef(spec, rawResponse)
    const schema = response?.content?.['application/json']?.schema
    const entry = {
      status,
      description: response?.description || '',
      typeLabel: schema ? typeLabel(spec, schema) : null,
      fields: [],
      exampleRaw: null,
      exampleHtml: null,
    }
    if (schema) {
      const isSuccess = status.startsWith('2')
      if (isSuccess) entry.fields = schemaFields(spec, schema)
      const example = schemaToExample(spec, schema)
      if (example !== null && example !== undefined) {
        entry.exampleRaw = JSON.stringify(example, null, 2)
        entry.exampleHtml = await highlight(entry.exampleRaw, 'json')
      }
    }
    out.push(entry)
  }
  // Stable order: 2xx first, then ascending
  out.sort((a, b) => a.status.localeCompare(b.status))
  return out
}

function exampleUrl(path, queryParams) {
  const requiredQuery = queryParams.filter((q) => q.required)
  let url = `${API_BASE_URL}${path}`
  if (requiredQuery.length) {
    const qs = requiredQuery
      .map((q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(String(q.example ?? ''))}`)
      .join('&')
    url += `?${qs}`
  }
  return url
}

/** Full model for one group page. All heavy lifting stays server-side. */
export async function buildGroupModel(spec, slug) {
  const group = groupBySlug(slug)
  if (!group) return null
  const byGroup = collectByGroup(spec)
  const entries = byGroup.get(slug) || []

  const operations = []
  for (const { path, method, op } of entries) {
    const pathParams = paramRows(spec, op.parameters, 'path')
    const queryParams = paramRows(spec, op.parameters, 'query')
    const requestBody = requestBodyModel(spec, op)
    const responses = await responseModels(spec, op)

    const auth = !NO_AUTH_OPERATIONS.has(`${method} ${path}`)
    const raw = buildSnippets({
      method,
      url: exampleUrl(path, queryParams),
      auth,
      // Session-only endpoints reject lh_ tokens — show a JWT placeholder
      // instead so the examples can't mislead (token substitution leaves it alone).
      authValue: group.access === 'session' ? 'YOUR_JWT' : undefined,
      contentType: requestBody?.contentType || null,
      bodyExample: requestBody ? requestBody.example : null,
      bodyFields: requestBody?.fieldSchemas || [],
    })

    const snippets = {
      curl: { raw: raw.curl, html: await highlight(raw.curl, 'bash') },
      js: { raw: raw.js, html: await highlight(raw.js, 'javascript') },
      python: { raw: raw.python, html: await highlight(raw.python, 'python') },
    }

    const isMultipart = requestBody?.contentType === 'multipart/form-data'
    operations.push({
      id: operationId(method, path),
      method,
      path,
      summary: op.summary || path,
      description: op.description || '',
      deprecated: !!op.deprecated,
      auth,
      access: group.access,
      tokenRight: group.rightsBucket
        ? { bucket: group.rightsBucket, action: METHOD_TO_ACTION[method] || 'read' }
        : null,
      pathParams,
      queryParams,
      requestBody: requestBody
        ? {
            contentType: requestBody.contentType,
            required: requestBody.required,
            typeLabel: requestBody.typeLabel,
            fields: requestBody.fields,
            exampleJson: JSON.stringify(requestBody.example, null, 2),
          }
        : null,
      responses,
      snippets,
      playground: {
        supported: true,
        contentType: requestBody?.contentType || null,
        pathParams: pathParams.map(({ name, required, example, type }) => ({
          name,
          required,
          example,
          type,
        })),
        queryParams: queryParams.map(({ name, required, example, type }) => ({
          name,
          required,
          example,
          type,
        })),
        bodyTemplate:
          requestBody && !isMultipart ? JSON.stringify(requestBody.example, null, 2) : null,
        // Multipart bodies render as individual form fields (file inputs for binary).
        formFields: isMultipart
          ? requestBody.fieldSchemas.map(({ name, schema }) => ({
              name,
              binary: isBinaryField(schema),
              required: requestBody.fields.find((f) => f.name === name)?.required || false,
              example: requestBody.example?.[name],
            }))
          : null,
      },
    })
  }

  return {
    slug: group.slug,
    title: group.title,
    description: group.description,
    baseUrl: API_BASE_URL,
    operations,
  }
}

/** Group directory (for the overview page): title, description, op counts. */
export function buildGroupDirectory(spec) {
  const byGroup = collectByGroup(spec)
  return API_GROUPS.map((group) => ({
    slug: group.slug,
    title: group.title,
    description: group.description,
    count: byGroup.get(group.slug).length,
  })).filter((g) => g.count > 0)
}

/** The 422 validation error schema straight from the spec (for the overview). */
export function validationErrorFields(spec) {
  const schema = spec.components?.schemas?.HTTPValidationError
  if (!schema) return []
  return schemaFields(spec, schema)
}
