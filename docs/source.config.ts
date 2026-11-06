import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
import lastModified from 'fumadocs-mdx/plugins/last-modified'
import { z } from 'zod'

// Code fence languages Shiki has no grammar for, mapped to close ones.
const FENCE_ALIASES: Record<string, string> = { env: 'ini' }

function remarkFenceAliases() {
  const walk = (node: any) => {
    if (node.type === 'code') {
      if (node.lang && FENCE_ALIASES[node.lang]) node.lang = FENCE_ALIASES[node.lang]
      // The content uses filename="…" (Nextra's syntax); the highlighter reads title="…".
      if (node.meta) node.meta = node.meta.replace(/\bfilename=/, 'title=')
    }
    node.children?.forEach(walk)
  }
  return (tree: any) => walk(tree)
}

// Docs content: every .mdx under content/. Navigation order comes from the
// _meta.json files, read by lib/source.js (not by fumadocs).
export const docs = defineDocs({
  dir: 'content',
  docs: {
    schema: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
    }),
  },
})

export default defineConfig({
  plugins: [lastModified()],
  mdxOptions: {
    remarkPlugins: [remarkFenceAliases],
    rehypeCodeOptions: {
      themes: { light: 'github-light', dark: 'github-light' },
      fallbackLanguage: 'plaintext',
    },
  },
})
