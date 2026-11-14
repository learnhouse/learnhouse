// Comment bodies are "markdown-lite": **bold**, *italic*, `code`, bare links,
// @mentions and line breaks. Parsed into tokens rendered as React elements,
// never as HTML, so a comment can't inject markup.

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'mention'; text: string; username: string }

// Order matters: code first so nothing inside backticks is formatted.
const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(^|[^\w@])@([A-Za-z0-9][\w.-]{0,63})/g

export function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let last = 0
  const push = (text: string) => {
    if (!text) return
    const prev = tokens[tokens.length - 1]
    if (prev && prev.kind === 'text') prev.text += text
    else tokens.push({ kind: 'text', text })
  }
  for (const match of line.matchAll(INLINE_RE)) {
    const start = match.index ?? 0
    const [whole, code, bold, italic, link, lead, username] = match
    if (username !== undefined) {
      // The lead character belongs to the text before the mention.
      push(line.slice(last, start) + (lead ?? ''))
      // A sentence's closing dot or dash is not part of the handle.
      const handle = username.replace(/[.-]+$/, '')
      tokens.push({ kind: 'mention', text: `@${handle}`, username: handle })
      push(username.slice(handle.length))
      last = start + whole.length
      continue
    }
    push(line.slice(last, start))
    if (code) tokens.push({ kind: 'code', text: code.slice(1, -1) })
    else if (bold) tokens.push({ kind: 'bold', text: bold.slice(2, -2) })
    else if (italic) tokens.push({ kind: 'italic', text: italic.slice(1, -1) })
    else if (link) tokens.push({ kind: 'link', text: link, href: link })
    last = start + whole.length
  }
  push(line.slice(last))
  return tokens
}

export function parseBody(body: string): InlineToken[][] {
  return (body || '').split('\n').map(parseInline)
}

export type MentionUser = { id: number; username: string }

/**
 * The ids of picked people still @named in the body. Picking someone from the
 * autocomplete records them; deleting their @handle from the text unpicks them.
 */
export function mentionedIds(body: string, picked: MentionUser[]): number[] {
  const named = new Set<string>()
  for (const line of parseBody(body)) {
    for (const token of line) if (token.kind === 'mention') named.add(token.username.toLowerCase())
  }
  const ids: number[] = []
  for (const user of picked) {
    if (named.has(user.username.toLowerCase()) && !ids.includes(user.id)) ids.push(user.id)
  }
  return ids
}

/**
 * The @query being typed at the caret, if any: `{ query, start }` where
 * `start` is the index of the `@`. Used to open the mention picker.
 */
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const match = before.match(/(^|[^\w@])@([\w.-]{0,64})$/)
  if (!match) return null
  const query = match[2]
  return { query, start: caret - query.length - 1 }
}

/** Replace the @query at `start` with the picked handle and a space. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  username: string
): { text: string; caret: number } {
  const insert = `@${username} `
  const next = text.slice(0, start) + insert + text.slice(caret)
  return { text: next, caret: start + insert.length }
}
