/*
 Put the formatting of rewritten text back on the words that survived (pure,
 unit tested). The client twin of the server's preserve.carry_marks, for
 rewrites that don't go through a proposal (the selection menu's own AI
 flow): every distinct mark of the old inline content (comment, spoiler,
 definition, highlight, link, bold...) is re-applied to the same text in the
 new content, nearest to where it was. Marks whose text is gone are reported.
*/

type JSONNode = Record<string, any>

const WATCHED = new Set(['comment', 'spoiler', 'definition', 'highlight', 'textEffect', 'link', 'textColor'])
const key = (m: JSONNode) => JSON.stringify(m, Object.keys(m).sort())

function chars(nodes: JSONNode[]): { text: string; marks: JSONNode[][]; atoms: (JSONNode | null)[] } {
  let text = ''
  const marks: JSONNode[][] = []
  const atoms: (JSONNode | null)[] = []
  for (const n of nodes) {
    if (n?.type === 'text') {
      // UTF-16 units throughout, so indices match String#indexOf
      const t = String(n.text ?? '')
      for (let i = 0; i < t.length; i++) {
        text += t[i]
        marks.push(Array.isArray(n.marks) ? [...n.marks] : [])
        atoms.push(null)
      }
    } else if (n) {
      text += '￼'
      marks.push([])
      atoms.push(n)
    }
  }
  return { text, marks, atoms }
}

function spans(text: string, marks: JSONNode[][]): { mark: JSONNode; start: number; end: number }[] {
  const out: { mark: JSONNode; start: number; end: number }[] = []
  const open = new Map<string, { mark: JSONNode; start: number }>()
  for (let pos = 0; pos <= text.length; pos++) {
    const here = new Map((pos < text.length ? marks[pos] : []).map((m) => [key(m), m]))
    for (const [k, v] of [...open]) {
      if (!here.has(k)) {
        out.push({ mark: v.mark, start: v.start, end: pos })
        open.delete(k)
      }
    }
    for (const [k, m] of here) if (!open.has(k)) open.set(k, { mark: m, start: pos })
  }
  return out
}

function nearestIndex(hay: string, needle: string, near: number): number {
  if (!needle.trim()) return -1
  let best = -1
  let dist = 2
  let at = hay.indexOf(needle)
  while (at !== -1) {
    const d = Math.abs(at / Math.max(1, hay.length) - near)
    if (d < dist) {
      best = at
      dist = d
    }
    at = hay.indexOf(needle, at + 1)
  }
  return best
}

/** `next` inline nodes with `prev`'s marks wherever their text survives. */
export function carryMarks(prev: JSONNode[], next: JSONNode[]): { nodes: JSONNode[]; lost: string[] } {
  const old = chars(prev)
  const cur = chars(next)
  const lost: string[] = []
  for (const { mark, start, end } of spans(old.text, old.marks)) {
    const type = String(mark.type)
    let needle = old.text.slice(start, end)
    let at = nearestIndex(cur.text, needle, start / Math.max(1, old.text.length))
    if (at < 0 && needle.trim() !== needle) {
      needle = needle.trim()
      at = nearestIndex(cur.text, needle, start / Math.max(1, old.text.length))
    }
    if (at < 0) {
      if (WATCHED.has(type) && !cur.marks.some((ms) => ms.some((m) => key(m) === key(mark)))) lost.push(type)
      continue
    }
    for (let i = at; i < at + needle.length; i++) {
      if (cur.atoms[i]) continue
      const kinds = new Set(cur.marks[i].map((m) => m.type))
      if (kinds.has('code') || (type === 'code' && kinds.size)) continue
      cur.marks[i] = [...cur.marks[i].filter((m) => m.type !== type), mark]
    }
  }
  const nodes: JSONNode[] = []
  cur.text.split('').forEach((ch, i) => {
    const atom = cur.atoms[i]
    if (atom) {
      nodes.push(atom)
      return
    }
    const ms = cur.marks[i]
    const last = nodes[nodes.length - 1]
    if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(ms)) last.text += ch
    else nodes.push(ms.length ? { type: 'text', text: ch, marks: ms } : { type: 'text', text: ch })
  })
  return { nodes, lost }
}
