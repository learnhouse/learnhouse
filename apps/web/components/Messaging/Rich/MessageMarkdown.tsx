'use client'

import React from 'react'
import ReactMarkdown from 'react-markdown'
import { GlobeSimple, Info, Lightbulb, Warning, WarningOctagon } from '@phosphor-icons/react'
import { MarkdownImageLink } from '@components/Objects/Activities/AI/MarkdownImageLink'
import {
  BASE_REMARK_PLUGINS,
  MATH_HINT,
  NO_REHYPE_PLUGINS,
  dropUnclosedMath,
  loadMathPlugins,
  normalizeMathDelimiters,
  type MathPlugins,
} from '@/lib/copilot/markdown'
import type { AgentSource } from '@services/messaging/messaging'
import CodeBlock from './CodeBlock'
import { CitationChip } from './Sources'
import { CALLOUT_MARKER, calloutKind, splitInline, type CalloutKind } from './parse'

function hastText(node: any): string {
  if (!node) return ''
  if (node.type === 'text') return node.value || ''
  return (node.children || []).map(hastText).join('')
}

const CALLOUTS: Record<CalloutKind, { label: string; Icon: any; tone: string; icon: string }> = {
  tip: { label: 'Tip', Icon: Lightbulb, tone: 'bg-green-50 text-green-900', icon: 'text-green-500' },
  note: { label: 'Note', Icon: Info, tone: 'bg-gray-100 text-gray-700', icon: 'text-gray-500' },
  important: { label: 'Important', Icon: Info, tone: 'bg-gray-100 text-gray-700', icon: 'text-gray-500' },
  warning: { label: 'Warning', Icon: Warning, tone: 'bg-yellow-100 text-yellow-900', icon: 'text-yellow-600' },
  caution: { label: 'Caution', Icon: WarningOctagon, tone: 'bg-red-50 text-red-900', icon: 'text-red-500' },
}

type Props = {
  content: string
  sources: AgentSource[]
  orgslug: string
  streaming?: boolean
  inverted?: boolean
  /** Agent replies cite sources and mark general knowledge in blockquotes. */
  agent?: boolean
}

function MessageMarkdown({ content, sources, orgslug, streaming = false, inverted = false, agent = false }: Props) {
  const text = React.useMemo(() => {
    const normalized = normalizeMathDelimiters(content)
    return streaming ? dropUnclosedMath(normalized) : normalized
  }, [content, streaming])

  const [mathPlugins, setMathPlugins] = React.useState<MathPlugins | null>(null)
  const needsMath = React.useMemo(() => MATH_HINT.test(text), [text])
  React.useEffect(() => {
    if (!needsMath || mathPlugins) return
    let active = true
    loadMathPlugins().then((p) => active && setMathPlugins(p))
    return () => {
      active = false
    }
  }, [needsMath, mathPlugins])

  const components = React.useMemo(() => {
    const withCitations = agent && sources.length > 0

    function inline(children: React.ReactNode): React.ReactNode {
      return React.Children.map(children, (child, ci) => {
        if (typeof child !== 'string') return child
        // A callout's "[!TIP]" marker is shown as the callout's own label.
        const value = ci === 0 ? child.replace(CALLOUT_MARKER, '') : child
        const parts = splitInline(value, withCitations)
        if (parts.length === 1 && parts[0].kind === 'text') return parts[0].value
        return (
          <>
            {parts.map((part, i) => {
              if (part.kind === 'text') return <React.Fragment key={i}>{part.value}</React.Fragment>
              if (part.kind === 'url')
                return (
                  <a
                    key={i}
                    href={part.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`underline underline-offset-2 break-all ${inverted ? 'text-white decoration-white/50' : 'text-gray-900 decoration-gray-300 hover:decoration-gray-900'}`}
                  >
                    {part.value.replace(/^https?:\/\//, '')}
                  </a>
                )
              return part.nums.map((n) => (
                <CitationChip key={`${i}-${n}`} num={n} sources={sources} orgslug={orgslug} inverted={inverted} />
              ))
            })}
          </>
        )
      })
    }

    return {
      p: ({ children }: any) => <p>{inline(children)}</p>,
      li: ({ children, className }: any) => <li className={className}>{inline(children)}</li>,
      td: ({ children }: any) => <td>{inline(children)}</td>,
      th: ({ children }: any) => <th>{inline(children)}</th>,
      strong: ({ children }: any) => <strong>{inline(children)}</strong>,
      em: ({ children }: any) => <em>{inline(children)}</em>,
      a: ({ href, children }: any) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {children}
        </a>
      ),
      img: ({ src, alt }: any) => <MarkdownImageLink src={src} alt={alt} />,
      table: ({ children }: any) => (
        <div className="not-prose my-2 overflow-x-auto rounded-xl border border-gray-200">
          <table className="lh-msg-table w-full text-xs border-collapse">{children}</table>
        </div>
      ),
      pre: ({ node }: any) => {
        const codeNode = node?.children?.find((c: any) => c.tagName === 'code')
        const cls: string[] = codeNode?.properties?.className || []
        const lang = (cls.find((c) => String(c).startsWith('language-')) || '').toString().replace('language-', '')
        return <CodeBlock code={hastText(codeNode).replace(/\n$/, '')} language={lang} />
      },
      code: ({ children }: any) => (
        <code
          className={`px-1 py-0.5 rounded-md text-[0.85em] font-mono before:content-none after:content-none ${
            inverted ? 'bg-white/15 text-white' : 'bg-gray-900/[0.06] text-gray-800'
          }`}
        >
          {children}
        </code>
      ),
      blockquote: ({ node, children }: any) => {
        const kind = calloutKind(node)
        if (kind) {
          const c = CALLOUTS[kind]
          return (
            <div className={`not-prose my-2 flex gap-2.5 rounded-lg px-3 py-2.5 text-sm leading-relaxed ${c.tone}`}>
              <c.Icon size={16} weight="fill" className={`shrink-0 mt-0.5 ${c.icon}`} />
              <div className="min-w-0 [&>p]:m-0 [&>p+p]:mt-1.5">
                <span className="font-semibold me-1">{c.label}.</span>
                {children}
              </div>
            </div>
          )
        }
        if (agent) {
          // The prompt asks agents to wrap anything beyond the course in a quote.
          return (
            <div className="not-prose my-2 rounded-lg bg-gray-100 px-3 py-2.5 text-sm leading-relaxed text-gray-700 [&>p]:m-0 [&>p+p]:mt-1.5">
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                <GlobeSimple size={11} weight="bold" />
                Beyond the course
              </span>
              {children}
            </div>
          )
        }
        return (
          <blockquote className={`border-s-2 ps-3 ${inverted ? 'border-white/40' : 'border-gray-300'}`}>{children}</blockquote>
        )
      },
    }
  }, [sources, orgslug, inverted, agent])

  return (
    <div
      className={`lh-msg-md max-w-none break-words leading-relaxed text-sm
        [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1
        ${inverted ? 'lh-msg-md-inverted text-white' : 'text-gray-800'}`}
    >
      <ReactMarkdown
        remarkPlugins={mathPlugins ? mathPlugins.remark : BASE_REMARK_PLUGINS}
        rehypePlugins={mathPlugins ? mathPlugins.rehype : NO_REHYPE_PLUGINS}
        components={components as any}
      >
        {text}
      </ReactMarkdown>
      <style jsx global>{`
        .lh-msg-table th { text-align: start; font-weight: 700; background: #fafafa; }
        .lh-msg-table th, .lh-msg-table td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
        .lh-msg-table tr:last-child td { border-bottom: none; }
        .lh-msg-md input[type='checkbox'] { margin: 0 6px 0 0; accent-color: #111; }
        .lh-msg-md ul.contains-task-list { list-style: none; padding-inline-start: 0.25rem; }
        .lh-msg-md > :first-child { margin-top: 0; }
        .lh-msg-md > :last-child { margin-bottom: 0; }
        .lh-msg-md p { margin: 0.4rem 0; }
        .lh-msg-md ul, .lh-msg-md ol { margin: 0.4rem 0; padding-inline-start: 1.25rem; }
        .lh-msg-md ul { list-style: disc; }
        .lh-msg-md ol { list-style: decimal; }
        .lh-msg-md li { margin: 0.15rem 0; }
        .lh-msg-md li::marker { color: #a3a3a3; }
        .lh-msg-md li > ul, .lh-msg-md li > ol { margin: 0.15rem 0; }
        .lh-msg-md h1, .lh-msg-md h2, .lh-msg-md h3, .lh-msg-md h4 {
          margin: 0.9rem 0 0.35rem; font-weight: 700; letter-spacing: -0.01em; color: #171717; line-height: 1.35;
        }
        .lh-msg-md h1 { font-size: 16px; }
        .lh-msg-md h2 { font-size: 15px; }
        .lh-msg-md h3, .lh-msg-md h4 { font-size: 14px; }
        .lh-msg-md strong { font-weight: 600; color: #171717; }
        .lh-msg-md a { text-decoration: underline; text-underline-offset: 2px; }
        .lh-msg-md hr { margin: 0.75rem 0; border: 0; border-top: 1px solid #ececec; }
        .lh-msg-md :not(pre) > code {
          font-size: 0.85em; padding: 0.1rem 0.3rem; border-radius: 4px; background: #f4f4f5; color: #27272a;
        }
        .lh-msg-md-inverted h1, .lh-msg-md-inverted h2, .lh-msg-md-inverted h3, .lh-msg-md-inverted h4,
        .lh-msg-md-inverted strong { color: #fff; }
        .lh-msg-md-inverted li::marker { color: rgba(255,255,255,0.6); }
        .lh-msg-md-inverted hr { border-top-color: rgba(255,255,255,0.2); }
        .lh-msg-md-inverted :not(pre) > code { background: rgba(255,255,255,0.15); color: #fff; }
      `}</style>
    </div>
  )
}

export default React.memo(MessageMarkdown)
