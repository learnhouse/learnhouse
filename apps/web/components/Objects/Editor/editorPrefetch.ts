// Warms the activity editor before it opens: the route (RSC payload + chunks)
// and the editor's own client chunk land in the HTTP cache, which the new tab
// the course page opens it in reuses.

let editorChunk: Promise<unknown> | null = null

export function prefetchActivityEditor(router: { prefetch: (_href: string) => void } | null, href: string) {
  try {
    router?.prefetch(href)
  } catch {
    // prefetch is a hint
  }
  if (!editorChunk && typeof window !== 'undefined') {
    editorChunk = import('./EditorWrapper').catch(() => {
      editorChunk = null
    })
  }
}
