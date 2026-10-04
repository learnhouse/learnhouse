import type { Editor } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'

/**
 * Pure helpers for turning the editor AI's streamed reply into TipTap nodes
 * and inserting them without ever dumping raw JSON into the document.
 *
 * The API strips the <<<CONTENT>>> markers before it sends `content_end`, but
 * the model still wraps its JSON in code fences, quotes it as a string, leaves
 * unescaped newlines inside string literals, or truncates on long replies.
 * Everything here is schema-driven and side-effect free so it can be unit
 * tested without React.
 */

export const AI_STREAMING_MARK = 'aiStreaming'

// Block types that require direct text content (NOT wrapped in paragraphs)
export const DIRECT_TEXT_BLOCK_TYPES = [
  'calloutInfo',
  'calloutWarning',
  'badge',
  'button',
]

export type AIContentNode = Record<string, any>

export type PreparedAIContent = {
  nodes: AIContentNode[]
  /** Set when the reply looked like JSON but nothing usable could be recovered. */
  error?: 'unparseable'
}

const JSON_START = /^[[{]/

/**
 * Strip the wrappers the model commonly puts around its payload:
 * content markers, a markdown code fence around the whole payload, a
 * JSON-encoded string, and stray ASCII control characters. Tabs, newlines and
 * carriage returns are kept so `repairJson` can escape the ones that sit
 * inside string literals.
 */
export function unwrapAIContent(raw: string): string {
  let content = (raw ?? '').trim()

  const marker = content.match(/<<<CONTENT>>>([\s\S]*?)(?:<<<END_CONTENT>>>|$)/i)
  if (marker) {
    content = marker[1].trim()
  }

  // Only unwrap a fence that wraps the whole payload. A fence somewhere in the
  // middle is most likely part of a code block the model wants inserted.
  if (content.startsWith('```')) {
    content = content.replace(/^```[\w-]*\s*/, '')
    content = content.replace(/\s*```\s*$/, '')
    content = content.trim()
  }

  if (content.length >= 2 && content.startsWith('"') && content.endsWith('"')) {
    try {
      const unwrapped = JSON.parse(content)
      if (typeof unwrapped === 'string') {
        content = unwrapped.trim()
      }
    } catch {
      // Not a JSON string literal; keep as-is.
    }
  }

  // eslint-disable-next-line no-control-regex
  content = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

  return content.trim()
}

/**
 * Best-effort repair of almost-valid JSON produced by a language model:
 * - escapes raw tab/newline/carriage-return characters inside string literals
 *   (and leaves the structural whitespace between tokens alone)
 * - drops trailing commas before a closing bracket
 * - closes a string literal and any brackets left open by a truncated reply
 */
export function repairJson(input: string): string {
  let out = ''
  const stack: string[] = []
  let inString = false
  let escapeNext = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (inString) {
      if (escapeNext) {
        escapeNext = false
        out += char
        continue
      }
      if (char === '\\') {
        escapeNext = true
        out += char
        continue
      }
      if (char === '"') {
        inString = false
        out += char
        continue
      }
      if (char === '\n') {
        out += '\\n'
        continue
      }
      if (char === '\t') {
        out += '\\t'
        continue
      }
      if (char === '\r') {
        out += '\\r'
        continue
      }
      out += char
      continue
    }

    if (char === '"') {
      inString = true
      out += char
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']')
      out += char
      continue
    }

    if (char === '}' || char === ']') {
      // Remove a trailing comma (and whitespace) that precedes this closer.
      out = out.replace(/,\s*$/, '')
      if (stack.length > 0 && stack[stack.length - 1] === char) {
        stack.pop()
      }
      out += char
      continue
    }

    out += char
  }

  if (inString) {
    // A dangling backslash would escape the closing quote we add.
    if (escapeNext) {
      out = out.slice(0, -1)
    }
    out += '"'
  }

  out = out.replace(/,\s*$/, '')

  while (stack.length > 0) {
    out += stack.pop()
  }

  return out
}

/**
 * Parse cleaned content into TipTap JSON. Returns `undefined` when the
 * content does not look like JSON or cannot be recovered.
 */
export function parseAIContentJson(content: string): unknown {
  if (!JSON_START.test(content)) {
    return undefined
  }

  const candidates = [content, repairJson(content)]
  const embedded = content.match(/[[{][\s\S]*[\]}]/)
  if (embedded && embedded[0] !== content) {
    candidates.push(embedded[0], repairJson(embedded[0]))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next repair strategy
    }
  }

  return undefined
}

/**
 * Recursively extract plain text from a TipTap/ProseMirror JSON node or array.
 */
export function extractTextFromTiptap(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content.map(extractTextFromTiptap).filter(Boolean).join(' ')
  }
  if (content && typeof content === 'object') {
    const node = content as AIContentNode
    const parts: string[] = []
    if (typeof node.text === 'string') {
      parts.push(node.text)
    }
    if (Array.isArray(node.content)) {
      parts.push(node.content.map(extractTextFromTiptap).filter(Boolean).join(' '))
    }
    return parts.filter(Boolean).join(' ')
  }
  return ''
}

/**
 * Turn plain text into paragraph nodes: blank lines separate paragraphs,
 * single newlines become hard breaks.
 */
export function textToParagraphs(text: string): AIContentNode[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      const content: AIContentNode[] = []
      lines.forEach((line, index) => {
        if (index > 0) {
          content.push({ type: 'hardBreak' })
        }
        content.push({ type: 'text', text: line })
      })
      return { type: 'paragraph', content }
    })
}

/**
 * Transform content to fix common AI output issues.
 * Specifically handles blocks that require direct text nodes (not paragraphs).
 */
export function transformContentForInsertion(content: any): any {
  if (Array.isArray(content)) {
    return content.map(transformContentForInsertion)
  }

  if (typeof content !== 'object' || content === null) {
    return content
  }

  if (DIRECT_TEXT_BLOCK_TYPES.includes(content.type) && Array.isArray(content.content)) {
    const unwrappedContent: AIContentNode[] = []

    for (const node of content.content) {
      if (node?.type === 'paragraph' && Array.isArray(node.content)) {
        for (const textNode of node.content) {
          if (textNode?.type === 'text') {
            unwrappedContent.push(textNode)
          }
        }
      } else if (node?.type === 'text') {
        unwrappedContent.push(node)
      }
    }

    if (unwrappedContent.length > 0) {
      return {
        ...content,
        content: unwrappedContent,
      }
    }
  }

  if (Array.isArray(content.content)) {
    return {
      ...content,
      content: transformContentForInsertion(content.content),
    }
  }

  return content
}

/**
 * Normalise whatever the model returned into a flat list of nodes the editor
 * schema knows about. A `doc` wrapper is unwrapped, unknown node types are
 * downgraded to paragraphs holding their text, and empty entries are dropped.
 */
export function normalizeAINodes(parsed: unknown, schema: Schema): AIContentNode[] {
  let value: any = parsed

  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.type === 'doc' &&
    Array.isArray(value.content)
  ) {
    value = value.content
  }

  const list: unknown[] = Array.isArray(value) ? value : [value]
  const nodes: AIContentNode[] = []

  for (const entry of list) {
    if (typeof entry === 'string') {
      nodes.push(...textToParagraphs(entry))
      continue
    }
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const node = transformContentForInsertion(entry)
    if (typeof node.type === 'string' && schema.nodes[node.type]) {
      nodes.push(node)
      continue
    }

    const text = extractTextFromTiptap(node)
    if (text) {
      nodes.push(...textToParagraphs(text))
    }
  }

  return nodes
}

/**
 * Full pipeline from the streamed `content_end` payload to insertable nodes.
 */
export function prepareAIContent(raw: string, schema: Schema): PreparedAIContent {
  const clean = unwrapAIContent(raw)
  if (!clean) {
    return { nodes: [] }
  }

  const parsed = parseAIContentJson(clean)
  if (parsed === undefined) {
    // Something that looks like TipTap JSON but cannot be parsed must not be
    // pasted into the document as prose.
    if (JSON_START.test(clean) && clean.includes('"type"')) {
      return { nodes: [], error: 'unparseable' }
    }
    return { nodes: textToParagraphs(clean) }
  }

  const nodes = normalizeAINodes(parsed, schema)
  if (nodes.length === 0) {
    return { nodes: [], error: 'unparseable' }
  }
  return { nodes }
}

/**
 * Add the AI streaming mark to every text node the schema allows it on.
 * Text inside nodes that forbid marks (code blocks) or carrying a mark that
 * excludes all others (inline code) is left untouched: ProseMirror throws on
 * such mark sets and the whole insert would fail.
 */
export function addStreamingMarks(
  content: any,
  schema: Schema,
  skipTypes: ReadonlySet<string> = new Set(),
  parentAllowsMark = true
): any {
  if (Array.isArray(content)) {
    return content.map((node) => addStreamingMarks(node, schema, skipTypes, parentAllowsMark))
  }

  if (typeof content !== 'object' || content === null) {
    return content
  }

  const markType = schema.marks[AI_STREAMING_MARK]
  if (!markType) {
    return content
  }

  if (content.type && skipTypes.has(content.type)) {
    return content
  }

  if (content.type === 'text') {
    if (!parentAllowsMark || typeof content.text !== 'string') {
      return content
    }
    const marks: AIContentNode[] = Array.isArray(content.marks) ? content.marks : []
    if (marks.some((mark) => mark?.type === AI_STREAMING_MARK)) {
      return content
    }
    const conflicts = marks.some((mark) => {
      const existing = mark?.type ? schema.marks[mark.type] : undefined
      return existing ? existing.excludes(markType) || markType.excludes(existing) : false
    })
    if (conflicts) {
      return content
    }
    return {
      ...content,
      marks: [...marks, { type: AI_STREAMING_MARK }],
    }
  }

  if (Array.isArray(content.content)) {
    const nodeType = content.type ? schema.nodes[content.type] : undefined
    const childrenAllowMark = nodeType ? nodeType.allowsMarkType(markType) : parentAllowsMark
    return {
      ...content,
      content: addStreamingMarks(content.content, schema, skipTypes, childrenAllowMark),
    }
  }

  return content
}

export type InsertAIContentResult = {
  from: number
  to: number
  inserted: number
  failed: number
}

const runInsert = (editor: Editor, content: any): boolean => {
  try {
    return editor.chain().focus().insertContent(content).run()
  } catch {
    return false
  }
}

/**
 * Insert a single node, degrading gracefully: with streaming marks, then
 * without them, then as a plain paragraph holding the node's text.
 */
export function insertAINode(
  editor: Editor,
  node: AIContentNode,
  specialTypes: ReadonlySet<string>
): boolean {
  const schema = editor.schema
  const isSpecial = typeof node.type === 'string' && specialTypes.has(node.type)

  const candidates: any[] = isSpecial
    ? [node, { type: node.type, attrs: node.attrs || {} }]
    : [addStreamingMarks(node, schema, specialTypes), node]

  for (const candidate of candidates) {
    if (runInsert(editor, candidate)) {
      return true
    }
  }

  const text = extractTextFromTiptap(node)
  if (!text) {
    return false
  }
  const fallback = addStreamingMarks(textToParagraphs(text), schema, specialTypes)
  return runInsert(editor, fallback)
}

/**
 * Insert prepared nodes one by one at the current selection. One node that the
 * schema rejects no longer aborts the rest of the reply.
 */
export function insertAIContent(
  editor: Editor,
  nodes: AIContentNode[],
  specialTypes: ReadonlySet<string>
): InsertAIContentResult {
  const from = editor.state.selection.from
  let inserted = 0
  let failed = 0

  for (const node of nodes) {
    if (insertAINode(editor, node, specialTypes)) {
      inserted++
    } else {
      failed++
    }
  }

  return { from, to: editor.state.selection.from, inserted, failed }
}
