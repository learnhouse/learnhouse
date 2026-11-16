/**
 * Structured data from published builder pages: the questions of their FAQ
 * blocks (FAQPage), skipping blocks hidden from signed-out visitors or on
 * every device, so the markup matches what crawlers can see.
 */
type Node = { type?: string; props?: Record<string, any>; children?: Node[]; hidden?: Record<string, boolean>; visibility?: string }

function visible(node: Node): boolean {
  if (node.visibility === 'logged_in') return false
  const h = node.hidden
  return !(h && h.desktop && h.tablet && h.mobile)
}

export function landingFaq(doc: any): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = []
  const walk = (nodes: Node[] | undefined, depth = 0) => {
    if (!Array.isArray(nodes) || depth > 20) return
    for (const n of nodes) {
      if (!n || !visible(n)) continue
      if (n.type === 'faq' && Array.isArray(n.props?.items)) {
        for (const item of n.props.items) {
          const question = String(item?.question || '').trim()
          const answer = String(item?.answer || '').trim()
          if (question && answer && out.length < 50) out.push({ question, answer })
        }
      }
      walk(n.children, depth + 1)
    }
  }
  walk(doc?.root)
  return out
}
