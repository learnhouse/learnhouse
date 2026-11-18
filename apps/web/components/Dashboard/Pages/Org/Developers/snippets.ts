// Snippet generator for the Developers Reference + Playground tabs.
// Returns curl / JavaScript (fetch) / Python (requests) one-liners for a given
// HTTP call. The token is rendered as a placeholder unless one is provided.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface SnippetInput {
  method: HttpMethod
  url: string                  // full URL (including base)
  body?: unknown               // request body (JSON-serializable)
  token?: string               // if omitted, snippets show <YOUR_TOKEN>
}

export interface SnippetBundle {
  curl: string
  js: string
  python: string
}

const TOKEN_PLACEHOLDER = '<YOUR_TOKEN>'

function authValue(token?: string): string {
  return token && token.trim() ? token.trim() : TOKEN_PLACEHOLDER
}

function indent(s: string, n = 2): string {
  const pad = ' '.repeat(n)
  return s.split('\n').map((l) => pad + l).join('\n')
}

export function buildSnippets({ method, url, body, token }: SnippetInput): SnippetBundle {
  const auth = authValue(token)
  const hasBody = body !== undefined && method !== 'GET' && method !== 'DELETE'
  const bodyJson = hasBody ? JSON.stringify(body, null, 2) : ''

  // ── curl ─────────────────────────────────────────────────────────────────
  const curlParts: string[] = []
  if (method !== 'GET') curlParts.push(`-X ${method}`)
  curlParts.push(`"${url}"`)
  curlParts.push(`-H "Authorization: Bearer ${auth}"`)
  if (hasBody) {
    curlParts.push(`-H "Content-Type: application/json"`)
    // Escape single quotes for shell heredoc-free single-line use
    const singleLineBody = JSON.stringify(body)
    curlParts.push(`-d '${singleLineBody.replace(/'/g, `'\\''`)}'`)
  }
  const curl = `curl ${curlParts.join(' \\\n  ')}`

  // ── JavaScript (fetch) ───────────────────────────────────────────────────
  const fetchOpts: Record<string, unknown> = {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
  }
  if (hasBody) fetchOpts.body = '__BODY__'
  let fetchOptsJson = JSON.stringify(fetchOpts, null, 2)
  if (hasBody) {
    fetchOptsJson = fetchOptsJson.replace('"__BODY__"', `JSON.stringify(${bodyJson})`)
  }
  const js = [
    `const res = await fetch("${url}", ${fetchOptsJson});`,
    `const data = await res.json();`,
    `console.log(data);`,
  ].join('\n')

  // ── Python (requests) ────────────────────────────────────────────────────
  const pyHeaders: Record<string, string> = { Authorization: `Bearer ${auth}` }
  if (hasBody) pyHeaders['Content-Type'] = 'application/json'
  const pyHeadersJson = JSON.stringify(pyHeaders, null, 4).replace(/"/g, '"')

  const pyCallLines: string[] = [
    `import requests`,
    ``,
    `res = requests.${method.toLowerCase()}(`,
    `    "${url}",`,
    `    headers=${pyHeadersJson},`,
  ]
  if (hasBody) {
    const pyBody = bodyJson.split('\n').map((l, i) => (i === 0 ? l : '    ' + l)).join('\n')
    pyCallLines.push(`    json=${pyBody},`)
  }
  pyCallLines.push(`)`, `print(res.json())`)
  const python = pyCallLines.join('\n')

  return { curl, js, python }
}
