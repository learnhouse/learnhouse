import { createHighlighter } from 'shiki'

/**
 * Server-side shiki singleton for reference code snippets.
 * The docs theme is forced light, so a single theme is enough.
 */

let highlighterPromise = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light'],
      langs: ['bash', 'javascript', 'python', 'json'],
    })
  }
  return highlighterPromise
}

export async function highlight(code, lang) {
  const highlighter = await getHighlighter()
  return highlighter.codeToHtml(code, { lang, theme: 'github-light' })
}
