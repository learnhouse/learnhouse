import { TOKEN_PLACEHOLDER } from './config'
import { isBinaryField } from './resolve'

/**
 * Generate curl / JavaScript (fetch) / Python (requests) snippets for an
 * operation. Handles application/json, multipart/form-data and
 * application/x-www-form-urlencoded request bodies.
 *
 * Ported from the dashboard snippet generator and extended for non-JSON
 * content types. The bearer token is always the placeholder — the client
 * substitutes the visitor's real token at render time.
 */

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function pyString(value) {
  return JSON.stringify(String(value))
}


/**
 * @param {object} input
 * @param {string} input.method    - 'GET' | 'POST' | ...
 * @param {string} input.url       - full URL with {placeholders} and example query string
 * @param {boolean} input.auth     - include the Authorization header
 * @param {string} input.authValue - bearer value shown in examples (defaults to the lh_ token
 *                                   placeholder; session-only endpoints pass a JWT placeholder)
 * @param {string|null} input.contentType
 * @param {object|null} input.bodyExample   - example body (JSON object; for form types a flat object)
 * @param {Array} input.bodyFields          - [{name, schema}] used to split binary vs scalar for multipart
 */
export function buildSnippets({
  method,
  url,
  auth = true,
  authValue = TOKEN_PLACEHOLDER,
  contentType = null,
  bodyExample = null,
  bodyFields = [],
}) {
  const hasBody =
    bodyExample !== null &&
    bodyExample !== undefined &&
    !['GET', 'DELETE'].includes(method)

  const binaryNames = new Set(
    bodyFields.filter((f) => isBinaryField(f.schema)).map((f) => f.name)
  )

  return {
    curl: buildCurl({ method, url, auth, authValue, contentType, bodyExample, binaryNames, hasBody }),
    js: buildJs({ method, url, auth, authValue, contentType, bodyExample, binaryNames, hasBody }),
    python: buildPython({ method, url, auth, authValue, contentType, bodyExample, binaryNames, hasBody }),
  }
}

// ── curl ────────────────────────────────────────────────────────────────────

function buildCurl({ method, url, auth, authValue, contentType, bodyExample, binaryNames, hasBody }) {
  const parts = []
  if (method !== 'GET') parts.push(`-X ${method}`)
  parts.push(`"${url}"`)
  if (auth) parts.push(`-H "Authorization: Bearer ${authValue}"`)

  if (hasBody) {
    if (contentType === 'multipart/form-data') {
      for (const [key, value] of Object.entries(bodyExample)) {
        if (binaryNames.has(key)) {
          parts.push(`-F ${shellSingleQuote(`${key}=@./${key}.png`)}`)
        } else {
          const v = typeof value === 'object' && value !== null ? JSON.stringify(value) : value
          parts.push(`-F ${shellSingleQuote(`${key}=${v}`)}`)
        }
      }
    } else if (contentType === 'application/x-www-form-urlencoded') {
      for (const [key, value] of Object.entries(bodyExample)) {
        parts.push(`--data-urlencode ${shellSingleQuote(`${key}=${value}`)}`)
      }
    } else {
      parts.push(`-H "Content-Type: application/json"`)
      parts.push(`-d ${shellSingleQuote(JSON.stringify(bodyExample))}`)
    }
  }

  return `curl ${parts.join(' \\\n  ')}`
}

// ── JavaScript (fetch) ──────────────────────────────────────────────────────

function buildJs({ method, url, auth, authValue, contentType, bodyExample, binaryNames, hasBody }) {
  const lines = []
  const headers = []
  if (auth) headers.push(`    Authorization: "Bearer ${authValue}",`)

  let bodyDecl = null
  let bodyRef = null

  if (hasBody) {
    if (contentType === 'multipart/form-data') {
      const formLines = ['const form = new FormData();']
      for (const [key, value] of Object.entries(bodyExample)) {
        if (binaryNames.has(key)) {
          formLines.push(`form.append("${key}", fileInput.files[0]); // your File or Blob`)
        } else {
          const v = typeof value === 'object' && value !== null ? JSON.stringify(value) : value
          formLines.push(`form.append("${key}", ${JSON.stringify(String(v))});`)
        }
      }
      bodyDecl = formLines.join('\n')
      bodyRef = 'form'
      // No Content-Type header: the browser sets the multipart boundary.
    } else if (contentType === 'application/x-www-form-urlencoded') {
      bodyRef = `new URLSearchParams(${JSON.stringify(bodyExample, null, 2)})`
    } else {
      headers.push(`    "Content-Type": "application/json",`)
      const pretty = JSON.stringify(bodyExample, null, 2)
        .split('\n')
        .map((l, i) => (i === 0 ? l : '  ' + l))
        .join('\n')
      bodyRef = `JSON.stringify(${pretty})`
    }
  }

  if (bodyDecl) {
    lines.push(bodyDecl, '')
  }

  lines.push(`const res = await fetch("${url}", {`)
  lines.push(`  method: "${method}",`)
  if (headers.length) {
    lines.push(`  headers: {`)
    lines.push(...headers)
    lines.push(`  },`)
  }
  if (bodyRef) lines.push(`  body: ${bodyRef},`)
  lines.push(`});`)
  lines.push(`const data = await res.json();`)
  lines.push(`console.log(data);`)

  return lines.join('\n')
}

// ── Python (requests) ───────────────────────────────────────────────────────

function pyDict(obj, indentLevel = 1) {
  const pad = '    '.repeat(indentLevel)
  const inner = Object.entries(obj)
    .map(([k, v]) => {
      let value
      if (v === null) value = 'None'
      else if (typeof v === 'boolean') value = v ? 'True' : 'False'
      else if (typeof v === 'number') value = String(v)
      else if (Array.isArray(v) || (typeof v === 'object' && v !== null))
        value = pyLiteral(v, indentLevel + 1)
      else value = pyString(v)
      return `${pad}${pyString(k)}: ${value},`
    })
    .join('\n')
  const closePad = '    '.repeat(indentLevel - 1)
  return `{\n${inner}\n${closePad}}`
}

function pyLiteral(value, indentLevel = 1) {
  if (value === null) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return pyString(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => pyLiteral(v, indentLevel)).join(', ')}]`
  }
  return pyDict(value, indentLevel)
}

function buildPython({ method, url, auth, authValue, contentType, bodyExample, binaryNames, hasBody }) {
  const lines = ['import requests', '']
  const callArgs = [`    "${url}",`]

  if (auth) {
    callArgs.push(`    headers={"Authorization": "Bearer ${authValue}"},`)
  }

  if (hasBody) {
    if (contentType === 'multipart/form-data') {
      const dataEntries = {}
      const fileEntries = []
      for (const [key, value] of Object.entries(bodyExample)) {
        if (binaryNames.has(key)) {
          fileEntries.push(`"${key}": open("${key}.png", "rb")`)
        } else {
          dataEntries[key] =
            typeof value === 'object' && value !== null ? JSON.stringify(value) : value
        }
      }
      if (Object.keys(dataEntries).length) {
        callArgs.push(`    data=${pyDict(dataEntries, 2)},`)
      }
      if (fileEntries.length) {
        callArgs.push(`    files={${fileEntries.join(', ')}},`)
      }
    } else if (contentType === 'application/x-www-form-urlencoded') {
      callArgs.push(`    data=${pyDict(bodyExample, 2)},`)
    } else {
      callArgs.push(`    json=${pyLiteral(bodyExample, 2)},`)
    }
  }

  lines.push(`res = requests.${method.toLowerCase()}(`)
  lines.push(...callArgs)
  lines.push(`)`)
  lines.push(`print(res.json())`)
  return lines.join('\n')
}
