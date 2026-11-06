import {
  API_GROUPS,
  BASE_URLS,
  GUIDES,
  SITE_URL,
  ACCESS_LABEL,
  RIGHTS_LABEL,
} from './config'

/**
 * Markdown renderings of the reference for LLMs and other tools:
 * an llms.txt-style index and one full file per group.
 */

const ACCESS_SENTENCE = {
  token: 'Accepts an lh_ API token or a user session.',
  'token-required': 'Requires an lh_ API token; user sessions are refused.',
  session: 'User session only; API tokens are refused with 403.',
  public: 'Credential endpoints, called with user credentials or a session.',
}

function cell(text) {
  return String(text ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

function accessLine(op) {
  if (!op.auth) return 'No authentication.'
  let line = ACCESS_SENTENCE[op.access] || ''
  if (op.tokenRight) {
    line += ` Token right: \`${op.tokenRight.bucket}:${op.tokenRight.action}\` (${RIGHTS_LABEL[op.tokenRight.bucket] || op.tokenRight.bucket}, ${op.tokenRight.action}).`
  }
  return line
}

export function renderIndexMarkdown({ operations, version }) {
  const lines = []
  lines.push('# LearnHouse API Reference', '')
  lines.push(
    `> REST API for LearnHouse, the open-source learning platform. ${operations.length} documented endpoints${version ? ` (API ${version})` : ''}. JSON over HTTP; every path starts with /api/v1.`,
    ''
  )
  lines.push('## Base URLs', '')
  for (const b of BASE_URLS) lines.push(`- ${b.label}: \`${b.url}/api/v1\`. ${b.note}`)
  lines.push('')
  lines.push('## Authentication', '')
  lines.push(
    '- Send `Authorization: Bearer <credential>`.',
    '- API tokens start with `lh_`, belong to one organization and carry Create/Read/Update/Delete rights per resource. The right an endpoint needs follows its method: GET read, POST create, PUT/PATCH update, DELETE delete.',
    '- User sessions: `POST /api/v1/auth/login` (form fields `username`, `password`) returns an access token valid 8 hours.',
    '- Some groups are session-only and refuse API tokens with 403.',
    ''
  )
  lines.push('## Guides', '')
  for (const g of GUIDES) lines.push(`- [${g.title}](${SITE_URL}/reference/guides/${g.slug}): ${g.description}`)
  lines.push(`- [Overview](${SITE_URL}/reference): base URLs, quickstart and endpoint groups.`)
  lines.push('')
  lines.push('## Machine-readable', '')
  lines.push(`- [operations.json](${SITE_URL}/reference/operations.json): every operation as JSON.`)
  lines.push(`- Full Markdown per group: \`${SITE_URL}/reference/llms/<group>.md\` (linked below).`)
  lines.push('')

  const byGroup = new Map()
  for (const op of operations) {
    if (!byGroup.has(op.group)) byGroup.set(op.group, [])
    byGroup.get(op.group).push(op)
  }
  lines.push('## Endpoints', '')
  for (const group of API_GROUPS) {
    const ops = byGroup.get(group.slug)
    if (!ops?.length) continue
    lines.push(`### ${group.title}`, '')
    lines.push(
      `${group.description} Access: ${ACCESS_LABEL[group.access]}. [Docs](${SITE_URL}/reference/${group.slug}) · [Markdown](${SITE_URL}/reference/llms/${group.slug}.md)`,
      ''
    )
    for (const op of ops) {
      lines.push(`- \`${op.method} ${op.path}\`: [${cell(op.summary)}](${op.url})${op.deprecated ? ' (deprecated)' : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function fieldLines(fields, depth = 0) {
  const out = []
  const pad = '  '.repeat(depth)
  for (const f of fields || []) {
    const bits = [`\`${f.name}\``, `\`${f.type || 'any'}\``, f.required ? 'required' : 'optional']
    if (f.nullable && !String(f.type).includes('null')) bits.push('nullable')
    if (f.defaultValue) bits.push(`default ${f.defaultValue}`)
    if (f.enumValues?.length) bits.push(`one of ${f.enumValues.map((v) => `\`${v}\``).join(', ')}`)
    if (f.constraints?.length) bits.push(f.constraints.join(', '))
    out.push(`${pad}- ${bits.join(' · ')}${f.description ? `: ${cell(f.description)}` : ''}`)
    if (f.children?.length && depth < 2) out.push(...fieldLines(f.children, depth + 1))
  }
  return out
}

function paramTable(title, rows) {
  if (!rows?.length) return []
  const out = [`**${title}**`, '', '| Name | Type | Required | Description |', '| --- | --- | --- | --- |']
  for (const p of rows) {
    const extra = [p.defaultValue && `Default ${p.defaultValue}.`, p.enumValues?.length && `One of ${p.enumValues.join(', ')}.`]
      .filter(Boolean)
      .join(' ')
    out.push(`| \`${p.name}\` | \`${cell(p.type)}\` | ${p.required ? 'yes' : 'no'} | ${cell([p.description, extra].filter(Boolean).join(' '))} |`)
  }
  out.push('')
  return out
}

export function renderGroupMarkdown(group) {
  const lines = []
  lines.push(`# ${group.title} · LearnHouse API`, '')
  lines.push(`> ${group.description}`, '')
  lines.push(`Access: ${ACCESS_SENTENCE[group.access]} HTML docs: ${SITE_URL}/reference/${group.slug}`, '')
  for (const op of group.operations) {
    lines.push(`## ${op.summary}${op.deprecated ? ' (deprecated)' : ''}`, '')
    lines.push(`\`${op.method} ${op.path}\``, '')
    lines.push(`Anchor: ${SITE_URL}/reference/${group.slug}#${op.id}`, '')
    lines.push(`Auth: ${accessLine(op)}`, '')
    if (op.description) lines.push(op.description.trim(), '')
    lines.push(...paramTable('Path parameters', op.pathParams))
    lines.push(...paramTable('Query parameters', op.queryParams))
    if (op.requestBody) {
      lines.push(
        `**Request body** (\`${op.requestBody.contentType}\`, ${op.requestBody.required ? 'required' : 'optional'}${op.requestBody.typeLabel ? `, \`${op.requestBody.typeLabel}\`` : ''})`,
        ''
      )
      lines.push(...fieldLines(op.requestBody.fields), '')
      if (op.requestBody.contentType === 'application/json' && op.requestBody.exampleJson) {
        lines.push('```json', op.requestBody.exampleJson, '```', '')
      }
    }
    if (op.responses.length) {
      lines.push('**Responses**', '')
      for (const r of op.responses) {
        lines.push(`- \`${r.status}\`${r.typeLabel ? ` \`${r.typeLabel}\`` : ''}: ${cell(r.description) || 'Response'}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}
