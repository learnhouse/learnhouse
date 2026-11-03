'use client'

import React, { useMemo, useState } from 'react'
import { Check, Copy } from '@phosphor-icons/react'
import { lowlight } from '@components/Objects/Editor/editorLowlight'

type HastNode = { type: string; value?: string; tagName?: string; properties?: any; children?: HastNode[] }

function toReact(nodes: HastNode[] | undefined, keyPrefix = ''): React.ReactNode[] {
  return (nodes || []).map((node, i) => {
    const key = `${keyPrefix}${i}`
    if (node.type === 'text') return node.value
    if (node.type === 'element') {
      const cls = node.properties?.className
      return (
        <span key={key} className={Array.isArray(cls) ? cls.join(' ') : cls}>
          {toReact(node.children, `${key}-`)}
        </span>
      )
    }
    return null
  })
}

function highlight(code: string, language: string): React.ReactNode[] | null {
  try {
    const tree = language && lowlight.registered(language)
      ? lowlight.highlight(language, code)
      : lowlight.highlightAuto(code)
    return toReact(tree.children as HastNode[])
  } catch {
    return null
  }
}

export default function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)
  // Highlighting is the expensive part of a streamed reply; only redo it when
  // this block's own text changes.
  const highlighted = useMemo(() => (code.length < 20_000 ? highlight(code, language) : null), [code, language])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be blocked; nothing useful to tell the reader.
    }
  }

  return (
    <div className="lh-msg-code not-prose my-2 rounded-lg overflow-hidden bg-[#0d0d0d] text-xs">
      <div className="flex items-center justify-between px-4 h-8 border-b border-white/10">
        <span className="text-[11px] font-mono font-medium text-gray-400 lowercase">{language || 'code'}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-white transition-colors"
          aria-label="Copy code"
        >
          {copied ? <Check size={12} weight="bold" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="m-0 px-4 py-3 overflow-x-auto leading-relaxed" dir="ltr" style={{ fontFamily: "'JetBrainsMono', monospace" }}>
        <code className="hljs text-[0.8rem] text-white" style={{ fontFamily: "inherit" }}>{highlighted ?? code}</code>
      </pre>
      <style jsx global>{`
        .lh-msg-code .hljs-comment, .lh-msg-code .hljs-quote { color: #616161; }
        .lh-msg-code .hljs-variable, .lh-msg-code .hljs-template-variable, .lh-msg-code .hljs-attribute,
        .lh-msg-code .hljs-attr, .lh-msg-code .hljs-tag, .lh-msg-code .hljs-name, .lh-msg-code .hljs-regexp,
        .lh-msg-code .hljs-link, .lh-msg-code .hljs-selector-id, .lh-msg-code .hljs-selector-class { color: #f98181; }
        .lh-msg-code .hljs-number, .lh-msg-code .hljs-meta, .lh-msg-code .hljs-built_in, .lh-msg-code .hljs-literal,
        .lh-msg-code .hljs-type, .lh-msg-code .hljs-params { color: #fbbc88; }
        .lh-msg-code .hljs-string, .lh-msg-code .hljs-symbol, .lh-msg-code .hljs-bullet { color: #b9f18d; }
        .lh-msg-code .hljs-title, .lh-msg-code .hljs-section { color: #faf594; }
        .lh-msg-code .hljs-keyword, .lh-msg-code .hljs-selector-tag { color: #70cff8; }
        .lh-msg-code .hljs-emphasis { font-style: italic; }
        .lh-msg-code .hljs-strong { font-weight: 700; }
      `}</style>
    </div>
  )
}
