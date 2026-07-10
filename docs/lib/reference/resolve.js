/**
 * OpenAPI 3.1 schema utilities: $ref resolution, allOf merging, anyOf-null
 * simplification, example generation and flattened field rows for display.
 *
 * The LearnHouse spec is fully self-contained (no external $refs), so a small
 * hand-rolled resolver is sufficient — no parser dependency needed.
 */

const MAX_REF_DEPTH = 10
const MAX_EXAMPLE_DEPTH = 5
const MAX_FIELD_DEPTH = 3

export function resolveRef(spec, schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > MAX_REF_DEPTH) return schema

  if (schema.$ref) {
    const parts = schema.$ref.replace(/^#\//, '').split('/')
    let resolved = spec
    for (const part of parts) resolved = resolved?.[part]
    // Preserve sibling description (3.1 allows $ref siblings)
    if (resolved && schema.description && !resolved.description) {
      resolved = { ...resolved, description: schema.description }
    }
    return resolveRef(spec, resolved, depth + 1)
  }

  if (schema.allOf) {
    const merged = { type: 'object', properties: {}, required: [] }
    for (const sub of schema.allOf) {
      const resolved = resolveRef(spec, sub, depth + 1)
      if (resolved?.properties) Object.assign(merged.properties, resolved.properties)
      if (resolved?.required) merged.required.push(...resolved.required)
      if (resolved?.description && !merged.description) merged.description = resolved.description
      if (resolved?.title && !merged.title) merged.title = resolved.title
    }
    return merged
  }

  return schema
}

/**
 * Collapse the OpenAPI 3.1 nullability pattern `anyOf: [X, {type: 'null'}]`
 * into `{...X, nullable: true}`. Genuine multi-member unions return the first
 * non-null member as `primary` with all member labels in `union`.
 */
export function simplifyAnyOf(spec, schema, depth = 0) {
  if (!schema || typeof schema !== 'object') return schema
  const resolved = resolveRef(spec, schema, depth)
  if (!resolved || typeof resolved !== 'object') return resolved

  const variants = resolved.anyOf || resolved.oneOf
  if (!variants || !Array.isArray(variants)) return resolved

  const nonNull = variants.filter((v) => !(v && v.type === 'null'))
  const nullable = nonNull.length < variants.length

  if (nonNull.length === 0) return { type: 'null' }

  if (nonNull.length === 1) {
    const inner = simplifyAnyOf(spec, resolveRef(spec, nonNull[0], depth + 1), depth + 1)
    return {
      ...inner,
      nullable: nullable || inner?.nullable || undefined,
      description: resolved.description || inner?.description,
      title: inner?.title || resolved.title,
    }
  }

  const members = nonNull.map((v) => resolveRef(spec, v, depth + 1))
  return {
    ...members[0],
    union: nonNull.map((v) => typeLabel(spec, v)),
    nullable: nullable || undefined,
    description: resolved.description || members[0]?.description,
  }
}

/** Short display label for a schema: "CourseRead", "CourseRead[]", "string | null" … */
export function typeLabel(spec, schema) {
  if (!schema) return ''
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop()
    return name
  }
  const simplified = simplifyAnyOf(spec, schema)
  if (!simplified) return ''

  let label
  if (simplified.union) {
    label = simplified.union.join(' | ')
  } else if (simplified.type === 'array') {
    const items = simplified.items
    const itemLabel = items?.$ref
      ? items.$ref.split('/').pop()
      : typeLabel(spec, items) || 'item'
    label = `${itemLabel}[]`
  } else if (simplified.title && (simplified.type === 'object' || simplified.properties)) {
    label = simplified.title
  } else if (simplified.enum) {
    label = 'enum'
  } else if (simplified.contentMediaType === 'application/octet-stream') {
    label = 'file'
  } else {
    label = simplified.type || (simplified.properties ? 'object' : 'any')
  }

  if (simplified.nullable) label += ' | null'
  return label
}

/** OpenAPI 3.1 binary (file upload) fields. */
export function isBinaryField(schema) {
  return (
    schema?.format === 'binary' ||
    schema?.contentEncoding === 'base64' ||
    schema?.contentMediaType === 'application/octet-stream'
  )
}

const NAME_HINTS = [
  [/email/i, 'ada@example.com'],
  [/password/i, 'a-strong-password'],
  [/(^|_)(url|uri|link)$/i, 'https://example.com'],
  [/slug/i, 'my-example-slug'],
  [/(^|_)name$/i, 'Example name'],
  [/description/i, 'An example description'],
  [/title/i, 'Example title'],
  [/color/i, '#0a0a0a'],
]

function exampleForString(schema, propName = '') {
  if (schema.enum?.length) return schema.enum[0]
  if (schema.contentMediaType === 'application/octet-stream') return '(file upload)'
  switch (schema.format) {
    case 'uuid':
      return 'd81f6a17-5c9a-4d0e-9b7f-2f4c8a3e1b6d'
    case 'date-time':
      return '2026-01-15T09:30:00Z'
    case 'date':
      return '2026-01-15'
    case 'email':
      return 'ada@example.com'
    case 'binary':
      return '(file upload)'
    default: {
      for (const [re, value] of NAME_HINTS) {
        if (re.test(propName)) return value
      }
      return 'string'
    }
  }
}

/** Generate a realistic example value for a schema. */
export function schemaToExample(spec, schema, depth = 0, propName = '') {
  if (!schema || depth > MAX_EXAMPLE_DEPTH) return null
  const resolved = simplifyAnyOf(spec, schema, 0)
  if (!resolved || typeof resolved !== 'object') return null

  if (resolved.example !== undefined) return resolved.example
  if (resolved.examples?.length) return resolved.examples[0]
  if (resolved.default !== undefined && resolved.default !== null) return resolved.default
  if (resolved.const !== undefined) return resolved.const

  if (resolved.type === 'object' || resolved.properties) {
    const obj = {}
    for (const [key, prop] of Object.entries(resolved.properties || {})) {
      obj[key] = schemaToExample(spec, prop, depth + 1, key)
    }
    return obj
  }

  if (resolved.type === 'array') {
    const item = schemaToExample(spec, resolved.items, depth + 1, propName)
    return [item === null ? '…' : item]
  }

  if (resolved.type === 'string') return exampleForString(resolved, propName)
  if (resolved.type === 'integer' || resolved.type === 'number') {
    if (resolved.enum?.length) return resolved.enum[0]
    if (/(^|_)id$/i.test(propName)) return 1
    if (/page/i.test(propName)) return 1
    if (/limit/i.test(propName)) return 10
    return 0
  }
  if (resolved.type === 'boolean') return false
  if (resolved.type === 'null') return null

  return null
}

/**
 * Flatten a schema into display rows:
 * { name, type, required, nullable, description, enumValues, children }
 */
export function schemaFields(spec, schema, depth = 0) {
  if (!schema || depth > MAX_FIELD_DEPTH) return []
  const resolved = simplifyAnyOf(spec, schema, 0)
  if (!resolved || typeof resolved !== 'object') return []

  // For arrays, describe the item shape
  if (resolved.type === 'array') {
    return schemaFields(spec, resolved.items, depth)
  }

  const required = new Set(resolved.required || [])
  const rows = []
  for (const [name, rawProp] of Object.entries(resolved.properties || {})) {
    const prop = simplifyAnyOf(spec, rawProp, 0)
    if (!prop || typeof prop !== 'object') continue

    const row = {
      name,
      type: typeLabel(spec, rawProp),
      required: required.has(name),
      nullable: !!prop.nullable,
      description: prop.description || '',
      enumValues: prop.enum || null,
      children: [],
    }

    if (depth < MAX_FIELD_DEPTH) {
      if (prop.type === 'object' || prop.properties) {
        row.children = schemaFields(spec, prop, depth + 1)
      } else if (prop.type === 'array') {
        const items = simplifyAnyOf(spec, prop.items, 0)
        if (items && (items.type === 'object' || items.properties)) {
          row.children = schemaFields(spec, items, depth + 1)
        }
      }
    }

    rows.push(row)
  }
  return rows
}
