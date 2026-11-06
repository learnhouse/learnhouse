// Turns a docs MDX page into plain Markdown for AI agents and crawlers:
// the per-page `.md` routes, llms.txt and llms-full.txt all use this.
//
// It keeps prose, headings, lists, tables and code, inlines `export const`
// strings that the page renders (prompts, commands), and replaces the site's
// interactive components with a text equivalent or drops them.
import fs from 'node:fs'
import path from 'node:path'

export const SITE_URL = 'https://docs.learnhouse.app'

export function parseFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return { data: {}, body: source }
  const data = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (m) data[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
  }
  return { data, body: source.slice(match[0].length) }
}

// `export const NAME = \`...\`` blocks: collect them, remove them from the body.
function extractExports(body) {
  const exports = {}
  const cleaned = body.replace(/^export const (\w+) = `([\s\S]*?)`\s*$/gm, (_m, name, value) => {
    exports[name] = value
    return ''
  })
  return { exports, body: cleaned }
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}=(?:"([^"]*)"|'([^']*)'|\\{['"\`]([^'"\`]*)['"\`]\\})`))
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

// Self-closing components → a Markdown equivalent (or nothing).
function replaceSelfClosing(body, ctx) {
  return body.replace(/<([A-Z][\w.]*)\b([^>]*?)\/>/g, (whole, name, attrs) => {
    switch (name) {
      case 'Screenshot': {
        const src = attr(attrs, 'src')
        const alt = attr(attrs, 'alt') || ''
        const caption = attr(attrs, 'caption')
        return src ? `![${alt}](${SITE_URL}${src})${caption ? `\n\n_${caption}_` : ''}` : ''
      }
      case 'DemoGallery':
        return ctx.demoList()
      case 'BuildPaths':
        return [
          '- [Embed](/developers/embed): paste an iframe of any activity into another site.',
          '- [React component](/developers/react): render activities in a React app with `@learnhouse/react`.',
          '- [Vue component](/developers/vue): the same in Vue with `@learnhouse/vue`.',
          '- [SDK](/developers/sdk): typed JavaScript/TypeScript client for the API.',
          '- [REST API & webhooks](/developers/api): every endpoint, from any language.',
        ].join('\n')
      default:
        return ''
    }
  })
}

export function mdxToMarkdown(source, { title: fallbackTitle, demoList = () => '' } = {}) {
  const { data, body: afterFrontmatter } = parseFrontmatter(source)
  const { exports, body: withoutExports } = extractExports(afterFrontmatter)
  let body = withoutExports

  // Shield code (fences and inline spans) from the JSX passes below.
  const shielded = []
  const shield = (text) => `\u0000${shielded.push(text) - 1}\u0000`
  body = body.replace(/^( *)```[\s\S]*?^\1```/gm, shield)
  body = body.replace(/`[^`\n]+`/g, shield)

  // Imports and JSX comments.
  body = body.replace(/^import\s.+$/gm, '')
  body = body.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  // Copy blocks that render an exported string → fenced block with that text.
  body = body.replace(/<CopyBlock\b([^>]*)>\s*\{(\w+)\}\s*<\/CopyBlock>/g, (_m, attrs, name) => {
    const label = attr(attrs, 'label') || ''
    const lang = /terminal/i.test(label) ? 'bash' : ''
    return exports[name] ? `\`\`\`${lang}\n${exports[name].trim()}\n\`\`\`` : ''
  })

  // Page heroes: their title becomes the page's h1, their children the intro.
  body = body.replace(/<DevHero\b([^>]*)>([\s\S]*?)<\/DevHero>/g, (_m, attrs, inner) => {
    const t = attr(attrs, 'title')
    const install = attr(attrs, 'install')
    return `${t ? `# ${t}\n\n` : ''}${inner.trim()}${install ? `\n\n\`\`\`bash\n${install}\n\`\`\`` : ''}`
  })

  // Callouts → blockquotes.
  body = body.replace(/<Callout\b[^>]*>([\s\S]*?)<\/Callout>/g, (_m, inner) =>
    inner
      .trim()
      .split('\n')
      .map((l) => `> ${l.trim()}`)
      .join('\n'),
  )

  // Tabs → a bold label per tab, in the order of `items`.
  body = body.replace(/<Tabs\b([^>]*)>([\s\S]*?)<\/Tabs>/g, (_m, attrs, inner) => {
    const itemsMatch = attrs.match(/items=\{\[([^\]]*)\]\}/)
    const items = itemsMatch ? [...itemsMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : []
    let i = 0
    return inner
      .replace(/<Tabs\.Tab[^>]*>/g, () => `**${items[i++] ?? `Option ${i}`}**\n`)
      .replace(/<\/Tabs\.Tab>/g, '')
  })

  body = replaceSelfClosing(body, { demoList })

  // Any remaining component wrappers (Steps, Gallery, figure…): keep their content.
  body = body.replace(/<\/?[A-Z][\w.]*\b[^>]*>/g, '')

  // Dedent lines that MDX allowed to be indented inside components.
  body = body
    .split('\n')
    .map((l) => l.replace(/^ {2,4}(?=\S)/, (m) => (/^\s*[-*\d`|>]/.test(l.trim()) ? '' : '')))
    .join('\n')

  // Put the code back (twice: a shielded fence can be inside a component that was shielded too).
  for (let pass = 0; pass < 2; pass++) body = body.replace(/\u0000(\d+)\u0000/g, (_m, i) => shielded[Number(i)])

  // Site-relative links → absolute, so the text works outside the site.
  body = body.replace(/\]\((\/[^)\s]*)\)/g, (_m, href) => `](${SITE_URL}${href})`)

  body = body.replace(/\n{3,}/g, '\n\n').trim()

  const title = data.title || fallbackTitle || (body.match(/^#\s+(.+)$/m) || [])[1] || 'LearnHouse Docs'
  if (!/^#\s/m.test(body.split('\n').slice(0, 3).join('\n'))) body = `# ${title}\n\n${body}`
  if (data.description && !body.includes(data.description)) {
    body = body.replace(/^(# .+\n)/, `$1\n> ${data.description}\n`)
  }
  return { title, description: data.description || '', markdown: body + '\n' }
}

/** Every content page: `{ slug: 'developers/react', file }` (slug '' for the home page). */
export function listContentPages(contentDir) {
  const pages = []
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, base ? `${base}/${entry.name}` : entry.name)
      else if (entry.name.endsWith('.mdx')) {
        const name = entry.name.replace(/\.mdx$/, '')
        pages.push({ slug: name === 'index' ? base : base ? `${base}/${name}` : name, file: full })
      }
    }
  }
  walk(contentDir, '')
  return pages.sort((a, b) => (a.slug === '' ? -1 : b.slug === '' ? 1 : a.slug.localeCompare(b.slug)))
}

/** Markdown list of the LearnHouse Headless demos, for pages that show the gallery. */
export function demoListFrom(demosJsonPath) {
  try {
    const { demos, sections } = JSON.parse(fs.readFileSync(demosJsonPath, 'utf8'))
    return sections
      .map((s) => {
        const items = demos.filter((d) => d.section === s.id)
        return `**${s.title}**\n\n${items.map((d) => `- [${d.name}](${SITE_URL}/demos/${d.id}): ${d.blurb}`).join('\n')}`
      })
      .join('\n\n')
  } catch {
    return ''
  }
}
