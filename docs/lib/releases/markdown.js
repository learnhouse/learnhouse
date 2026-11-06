/**
 * A deliberately small markdown parser for LearnHouse GitHub release bodies.
 *
 * It understands exactly what the release workflow writes: `#`/`##`/`###`
 * headings, `- ` bullets, fenced code, `>` blockquotes (incl. GitHub
 * `[!WARNING]` alerts), `---` rules, paragraphs, and inline `code`,
 * **bold**, #123 refs, @handles, bare http(s) URLs and trailing commit hashes
 * like (`c86d0249`). Raw HTML lines are dropped.
 *
 * Output is a plain JSON tree of strings. Nothing here produces HTML: the
 * React renderer turns nodes into elements, so all text is escaped by React.
 */

const COMMIT_RE = /^[0-9a-f]{7,40}$/
const TRAILING_COMMIT_RE = /\s*\(`([0-9a-f]{7,40})`\)\s*$/
const HANDLE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

/** The docs UI uses no emoji; release prose sometimes does ("📁 Folders"). */
export function stripEmoji(text) {
  return text.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D\u20E3]+\s?/gu, '')
}

/* ── Inline ──────────────────────────────────────────────────── */

/**
 * Tokenize one line of inline markdown.
 * Node shapes: {t:'text',v} {t:'code',v} {t:'commit',v} {t:'strong',c:[...]}
 * {t:'link',href,v} {t:'ref',n} {t:'user',v}
 */
export function parseInline(src) {
  const out = []
  let buf = ''
  const flush = () => {
    const v = stripEmoji(buf)
    if (v) out.push({ t: 'text', v })
    buf = ''
  }

  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const prev = i > 0 ? src[i - 1] : ' '
    const boundary = /[\s(\[,]/.test(prev)

    // `code`
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        const v = src.slice(i + 1, end)
        out.push(COMMIT_RE.test(v) && prev === '(' ? { t: 'commit', v } : { t: 'code', v })
        i = end + 1
        continue
      }
    }

    // **strong**
    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2)
      if (end > i + 2 && src.slice(i + 2, end).trim()) {
        flush()
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }

    // bare http(s) URL
    if ((ch === 'h') && boundary && /^https?:\/\//.test(src.slice(i, i + 8))) {
      const m = /^https?:\/\/[^\s<>()`]+/.exec(src.slice(i))
      if (m) {
        let url = m[0].replace(/[.,;:!?]+$/, '')
        flush()
        out.push({ t: 'link', href: url, v: url })
        i += url.length
        continue
      }
    }

    // #123 → PR / issue ref
    if (ch === '#' && boundary) {
      const m = /^#(\d{1,7})\b/.exec(src.slice(i))
      if (m) {
        flush()
        out.push({ t: 'ref', n: m[1] })
        i += m[0].length
        continue
      }
    }

    // @handle → GitHub profile
    if (ch === '@' && boundary) {
      const m = /^@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?![A-Za-z0-9-/.@])/.exec(src.slice(i))
      if (m) {
        flush()
        out.push({ t: 'user', v: m[1] })
        i += m[0].length
        continue
      }
    }

    buf += ch
    i++
  }
  flush()
  return out
}

/** Plain-text projection of inline nodes (for titles, search, counts). */
export function inlineText(nodes) {
  return nodes
    .map((n) => {
      if (n.t === 'strong') return inlineText(n.c)
      if (n.t === 'ref') return `#${n.n}`
      if (n.t === 'user') return `@${n.v}`
      if (n.t === 'br') return ' '
      return n.v
    })
    .join('')
}

/** A list item: inline content plus an optional trailing commit hash. */
function parseItem(text) {
  const m = TRAILING_COMMIT_RE.exec(text)
  const body = m ? text.slice(0, m.index) : text
  return { c: parseInline(body.trim()), commit: m ? m[1] : null }
}

/* ── Blocks ──────────────────────────────────────────────────── */

/**
 * Parse lines into blocks:
 * {type:'heading',level,c} {type:'para',c} {type:'list',items:[{c,commit}]}
 * {type:'code',lang,text} {type:'quote',alert,blocks}
 */
function parseBlocks(lines) {
  const blocks = []
  let para = null
  let list = null
  const endPara = () => {
    if (para) {
      const c = []
      para.forEach((line, idx) => {
        if (idx > 0) c.push({ t: 'br' })
        c.push(...parseInline(line))
      })
      if (c.some((n) => n.t !== 'br' && !(n.t === 'text' && !n.v.trim()))) blocks.push({ type: 'para', c })
    }
    para = null
  }
  const endList = () => {
    if (list) blocks.push({ type: 'list', items: list })
    list = null
  }
  const endAll = () => {
    endPara()
    endList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // fenced code
    const fence = /^```\s*([\w-]*)\s*$/.exec(trimmed)
    if (fence) {
      endAll()
      const body = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) body.push(lines[i++])
      blocks.push({ type: 'code', lang: fence[1] || '', text: body.join('\n') })
      continue
    }

    if (trimmed === '') {
      endAll()
      continue
    }

    // blockquote run (may carry a GitHub alert marker)
    if (trimmed.startsWith('>')) {
      endAll()
      const inner = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        inner.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      i--
      let alert = null
      const marker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(inner[0] || '')
      if (marker) {
        alert = marker[1].toLowerCase()
        inner.shift()
      }
      blocks.push({ type: 'quote', alert, blocks: parseBlocks(inner) })
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      endAll()
      continue
    }

    // raw HTML (e.g. <img>) is not rendered
    if (/^<\/?[a-zA-Z!]/.test(trimmed)) {
      endAll()
      continue
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(trimmed)
    if (heading) {
      endAll()
      blocks.push({ type: 'heading', level: heading[1].length, c: parseInline(heading[2]) })
      continue
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed)
    if (bullet) {
      endPara()
      if (!list) list = []
      list.push(parseItem(bullet[1]))
      continue
    }

    endList()
    if (!para) para = []
    para.push(trimmed)
  }
  endAll()
  return blocks
}

/**
 * Split a body into `##` sections. Content before the first `##` lands in a
 * section with `title: null`.
 */
export function parseReleaseBody(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n')
  const sections = []
  let current = { title: null, lines: [] }
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence
    const h2 = !inFence && /^##\s+(.*?)\s*$/.exec(line)
    if (h2 && !line.startsWith('###')) {
      sections.push(current)
      current = { title: h2[1], lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  sections.push(current)
  return sections
    .map((s) => ({ title: s.title, blocks: parseBlocks(s.lines) }))
    .filter((s) => s.title !== null || s.blocks.length > 0)
}

/** Strip emoji / symbols from a section heading: "✨ Features" → "Features". */
export function cleanHeading(title) {
  return String(title || '')
    .replace(/[^\p{L}\p{N}\s&/().,'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extract unique, valid @handles from free text (drops junk like @{"message"…}). */
export function extractHandles(text) {
  const seen = new Map()
  for (const raw of String(text || '').split(/[\s,]+/)) {
    if (!raw.startsWith('@')) continue
    const handle = raw.slice(1).replace(/[.!?]+$/, '')
    if (!HANDLE_RE.test(handle)) continue
    const key = handle.toLowerCase()
    if (!seen.has(key)) seen.set(key, handle)
  }
  return [...seen.values()]
}
