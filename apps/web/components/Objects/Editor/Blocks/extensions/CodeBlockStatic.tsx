'use client'
/*
 The code block as StaticCanva (learners, embeds, @learnhouse/react) draws it.

 The editor highlights code through a ProseMirror decoration plugin, which a
 static render never runs, so this highlights with the same lowlight instance.
 A block without the Editor Plus options renders the same <pre><code> as
 before; with line numbers or highlighted lines the tree is cut into lines
 and each line starts with the same marker span the editor's widget uses, so
 one stylesheet (Plus/upgrades/upgrades.css) styles both. Learners get the
 file name header and a copy button, as in the editor-backed view.
*/
import React, { useMemo } from 'react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { FileCode } from '@phosphor-icons/react'
import { lowlight } from '../../editorLowlight'
import { CopyButton, codePreProps } from './CodeBlock'
import { codeLineOptions, hastToLines, needsLineMarkup, type Hast } from './codeBlockModel'

function hastToReact(node: Hast, key: number): React.ReactNode {
  if (node.type === 'text') return node.value
  const children = (node.children ?? []).map(hastToReact)
  if (node.type === 'element') {
    return React.createElement(node.tagName ?? 'span', { key, className: node.properties?.className?.join(' ') }, children)
  }
  return children
}

function linesToReact(tree: Hast | null, code: string, attrs: any): React.ReactNode {
  const { showLineNumbers, highlight } = codeLineOptions(attrs)
  const lines = hastToLines(tree, code)
  return lines.map((tokens, i) => (
    <React.Fragment key={i}>
      <span
        className="lh-code-line-start"
        aria-hidden="true"
        data-ln={showLineNumbers ? i + 1 : undefined}
        data-hl={highlight.has(i + 1) ? 'true' : undefined}
      />
      {tokens.map((tok, j) => (tok.classes.length ? <span key={j} className={tok.classes.join(' ')}>{tok.text}</span> : tok.text))}
      {i < lines.length - 1 ? '\n' : null}
    </React.Fragment>
  ))
}

export function StaticCodeBlock({ node }: { node: PMNode }) {
  const language: string | null = node.attrs.language
  const filename: string = node.attrs.filename || ''
  const code = node.textContent
  const tree = useMemo(() => {
    try {
      return (language && lowlight.registered(language) ? lowlight.highlight(language, code) : lowlight.highlightAuto(code)) as unknown as Hast
    } catch {
      return null
    }
  }, [language, code])
  const perLine = needsLineMarkup(codeLineOptions(node.attrs))
  return (
    <div className="lh-code-block group/code relative">
      {filename && (
        <div className="flex items-center gap-1.5 rounded-t-lg bg-neutral-800 px-3 py-1.5 text-[12px] text-neutral-300">
          <FileCode size={13} />
          <span className="truncate font-mono">{filename}</span>
        </div>
      )}
      <pre className={filename ? '!mt-0 !rounded-t-none' : undefined} {...codePreProps(node.attrs, code)}>
        <code className={language ? `language-${language}` : undefined}>
          {perLine ? linesToReact(tree, code, node.attrs) : tree ? hastToReact(tree, 0) : code}
        </code>
      </pre>
      {code.trim() && (
        <div
          className="absolute end-2 top-2 opacity-0 transition-opacity group-hover/code:opacity-100 focus-within:opacity-100 max-md:opacity-100"
          style={filename ? { top: 2 } : undefined}
        >
          <CopyButton text={code} className="bg-neutral-800/80" notify />
        </div>
      )}
    </div>
  )
}

export default StaticCodeBlock
