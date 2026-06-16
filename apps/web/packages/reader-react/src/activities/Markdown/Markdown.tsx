'use client'

import { type CSSProperties, useCallback, useEffect, useState } from 'react'

function toRawUrl(url: string): string {
  // GitHub: /blob/branch/path → raw.githubusercontent.com/.../branch/path
  const gh = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`
  // GitLab: /-/blob/ → /-/raw/
  const gl = url.match(/^(https?:\/\/gitlab\.com\/.+)\/-\/blob\/(.+)$/)
  if (gl) return `${gl[1]}/-/raw/${gl[2]}`
  // Bitbucket: /src/branch/path → /raw/branch/path
  const bb = url.match(/^(https?:\/\/bitbucket\.org\/[^/]+\/[^/]+)\/src\/(.+)$/)
  if (bb) return `${bb[1]}/raw/${bb[2]}`
  return url
}

export interface MarkdownActivityProps {
  activity: { content?: { markdown_url?: string } }
  style?: CSSProperties
}

export function MarkdownActivity({ activity, style }: MarkdownActivityProps) {
  const markdownUrl = activity.content?.markdown_url ?? ''
  const [Markdown, setMarkdown] = useState<{
    component: any
    remarkGfm: any
    rehypeHighlight: any
    rehypeRaw: any
    rehypeSanitize: any
    sanitizeSchema: any
  } | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      import('react-markdown'),
      import('remark-gfm'),
      import('rehype-highlight'),
      import('rehype-raw'),
      import('rehype-sanitize'),
      import('github-markdown-css/github-markdown-light.css'),
    ]).then(([rm, gfm, hl, raw, sanitize]) => {
      if (cancelled) return
      // Extend the default sanitize schema to keep the className attributes
      // that rehype-highlight adds for syntax highlighting (`hljs`, `hljs-*`,
      // `language-*`). Without this, code blocks lose their colors.
      const baseSchema = sanitize.defaultSchema
      const schema = {
        ...baseSchema,
        attributes: {
          ...(baseSchema.attributes ?? {}),
          code: [
            ...(baseSchema.attributes?.code ?? []),
            ['className', /^hljs($|[- ])/, /^language-[\w-]+$/],
          ],
          span: [
            ...(baseSchema.attributes?.span ?? []),
            ['className', /^hljs($|[- ])/],
          ],
        },
      }
      setMarkdown({
        component: rm.default,
        remarkGfm: gfm.default,
        rehypeHighlight: hl.default,
        rehypeRaw: raw.default,
        rehypeSanitize: sanitize.default,
        sanitizeSchema: schema,
      })
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const fetchMarkdown = useCallback(async (url: string) => {
    if (!url) {
      setError('No markdown URL configured')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(toRawUrl(url))
      if (!res.ok) throw new Error(`Failed to fetch markdown (${res.status})`)
      setContent(await res.text())
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch markdown')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMarkdown(markdownUrl)
  }, [markdownUrl, fetchMarkdown])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-sm text-gray-600">
        <p>{error}</p>
        <button
          onClick={() => fetchMarkdown(markdownUrl)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    )
  }
  if (!Markdown) return null

  const {
    component: ReactMarkdown,
    remarkGfm,
    rehypeHighlight,
    rehypeRaw,
    rehypeSanitize,
    sanitizeSchema,
  } = Markdown
  // Plugin order matters: parse raw HTML in the markdown source first, then
  // strip dangerous nodes (script/iframe/style/event-handler attrs/javascript:
  // URLs/etc.), then add syntax-highlighting classes to whatever survived.
  return (
    <div className="w-full px-6 py-6" style={style}>
      <div
        className="markdown-body"
        style={style ? { backgroundColor: 'transparent', color: 'inherit' } : undefined}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeHighlight]}
        >
          {content ?? ''}
        </ReactMarkdown>
      </div>
    </div>
  )
}

export default MarkdownActivity
