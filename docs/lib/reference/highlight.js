import { createHighlighter } from 'shiki'

/**
 * Server-side shiki singleton for reference code snippets.
 *
 * Shiki's default HTML puts an inline `style="color:#…"` on every token, and
 * the reference renders a few thousand snippets: that markup was most of the
 * page weight (twice, once in the HTML and once in the RSC payload). We only
 * take shiki's tokens and emit short class names instead; reference.css maps
 * them back to colours. Adjacent tokens with the same colour are merged, and
 * default-coloured text gets no span at all.
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

// github-light token colours → classes defined in reference.css (.lhr-pre .k …)
const COLOR_CLASS = {
  '#D73A49': 'k', // keyword
  '#6F42C1': 'f', // function
  '#005CC5': 'c', // constant, number, flag
  '#032F62': 's', // string
  '#6A737D': 'm', // comment
  '#E36209': 'v', // variable / parameter
  '#22863A': 'g', // tag
  '#B31D28': 'e', // invalid
}
const DEFAULT_COLOR = '#24292E'

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderLine(tokens) {
  let out = ''
  let runClass = null
  let runText = ''
  const flush = () => {
    if (!runText) return
    const text = escapeHtml(runText)
    out += runClass ? `<span class="${runClass}">${text}</span>` : text
    runText = ''
  }
  for (const token of tokens) {
    const color = (token.color || DEFAULT_COLOR).toUpperCase()
    let cls = color === DEFAULT_COLOR ? null : COLOR_CLASS[color] || null
    // Whitespace looks the same in any colour: fold it into the current run.
    if (!token.content.trim()) cls = runClass
    if (cls !== runClass) {
      flush()
      runClass = cls
    }
    runText += token.content
  }
  flush()
  return out
}

export async function highlight(code, lang) {
  const highlighter = await getHighlighter()
  const { tokens } = highlighter.codeToTokens(code, { lang, theme: 'github-light' })
  return `<pre class="lhr-pre"><code>${tokens.map(renderLine).join('\n')}</code></pre>`
}
