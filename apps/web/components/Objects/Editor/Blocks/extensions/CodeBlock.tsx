'use client'
/*
 Code block with a language picker, an optional file name and a copy button.

 Same node (`codeBlock`) and same stored attrs as before plus an optional
 `filename` and the Editor Plus options `showLineNumbers`, `highlightLines`
 ("2,4-6") and `wrap` (codeBlockModel.ts). Learners see the code exactly as
 before unless the author set one of them; a copy button appears on hover
 (floating, so it doesn't move anything), and a file name header only when
 the author set one. Line numbers and highlight bars are widget decorations
 (codeLinesPlugin), so the code itself stays one plain text node.

 StaticCanva renders the learner view with CodeBlockStatic.tsx.
*/
import React from 'react'
import { NodeViewContent, NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ArrowUDownLeft, Check, Copy, FileCode, Highlighter, ListNumbers } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { CODE_BLOCK_EXTRA_ATTRS } from '../schema/blockAttrs'
import { codeLineOptions, codeLines, codePreAttrs, normalizeHighlightLines } from './codeBlockModel'
import { cn } from '@/lib/utils'

const LANGUAGE_LABELS: Record<string, string> = {
  plaintext: 'Plain text', bash: 'Bash', shell: 'Shell', c: 'C', cpp: 'C++', csharp: 'C#', css: 'CSS', go: 'Go',
  java: 'Java', javascript: 'JavaScript', json: 'JSON', kotlin: 'Kotlin', markdown: 'Markdown', php: 'PHP',
  python: 'Python', ruby: 'Ruby', rust: 'Rust', sql: 'SQL', swift: 'Swift', typescript: 'TypeScript',
  xml: 'HTML / XML', yaml: 'YAML', r: 'R', scss: 'SCSS', diff: 'Diff', dockerfile: 'Dockerfile',
}

/** <pre> props for the line options (none for a block without them). */
export function codePreProps(attrs: any, text: string): Record<string, any> {
  const { style, ...data } = codePreAttrs(attrs, text)
  if (!style) return data
  const [name, value] = style.split(':')
  return { ...data, style: { [name]: value } }
}

export function CopyButton({ text, className, notify = false }: { text: string; className?: string; notify?: boolean }) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      contentEditable={false}
      aria-label={copied ? t('editor.blocks_v2.copied', 'Copied') : t('editor.blocks_v2.copy_code', 'Copy code')}
      title={copied ? t('editor.blocks_v2.copied', 'Copied') : t('editor.blocks_v2.copy_code', 'Copy code')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          if (notify) toast.success(t('editor.blocks_v2.code_copied', 'Code copied to the clipboard'))
          setTimeout(() => setCopied(false), 1400)
        }).catch(() => {
          if (notify) toast.error(t('editor.blocks_v2.code_copy_failed', 'Could not copy. Select the code and copy it by hand.'))
        })
      }}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors',
        copied ? 'text-emerald-400' : 'text-neutral-400 hover:bg-white/10 hover:text-white',
        className,
      )}
    >
      {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
      <span className="max-sm:hidden">{copied ? t('editor.blocks_v2.copied', 'Copied') : t('editor.blocks_v2.copy', 'Copy')}</span>
    </button>
  )
}

const HEADER_TOGGLE =
  'inline-flex h-6 w-6 flex-none items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50'

/** Line numbers, lines to highlight and wrapping, in the editor's header bar. */
function LineOptions({ attrs, update }: { attrs: any; update: (_a: Record<string, any>) => void }) {
  const { t } = useTranslation()
  const stored: string = attrs.highlightLines || ''
  // null while not typing: the field shows the stored value (undo, collaborators).
  const [draft, setDraft] = React.useState<string | null>(null)
  const commit = () => {
    const next = normalizeHighlightLines(draft ?? stored)
    setDraft(null)
    if (next !== (attrs.highlightLines || null)) update({ highlightLines: next })
  }
  const numbers = attrs.showLineNumbers === true
  const wrap = attrs.wrap === true
  return (
    <>
      <label className="flex h-6 min-w-0 items-center gap-1 rounded-md bg-neutral-700/70 px-1.5 text-neutral-400 focus-within:ring-2 focus-within:ring-sky-500/50 max-sm:hidden">
        <Highlighter size={12} className="flex-none" aria-hidden />
        <input
          value={draft ?? stored}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d,\-–\s]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          inputMode="numeric"
          placeholder={t('editor.blocks_v2.code_highlight_placeholder', '2,4-6')}
          aria-label={t('editor.blocks_v2.code_highlight', 'Lines to highlight (for example 2,4-6)')}
          title={t('editor.blocks_v2.code_highlight', 'Lines to highlight (for example 2,4-6)')}
          className="w-14 bg-transparent font-mono text-[11px] text-neutral-200 outline-none placeholder:text-neutral-500"
        />
      </label>
      <button
        type="button"
        aria-pressed={numbers}
        aria-label={t('editor.blocks_v2.code_line_numbers', 'Line numbers')}
        title={t('editor.blocks_v2.code_line_numbers', 'Line numbers')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => update({ showLineNumbers: !numbers })}
        className={cn(HEADER_TOGGLE, numbers ? 'bg-white/15 text-white' : 'text-neutral-400 hover:bg-white/10 hover:text-white')}
      >
        <ListNumbers size={13} />
      </button>
      <button
        type="button"
        aria-pressed={wrap}
        aria-label={t('editor.blocks_v2.code_wrap', 'Wrap long lines')}
        title={t('editor.blocks_v2.code_wrap', 'Wrap long lines')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => update({ wrap: !wrap })}
        className={cn(HEADER_TOGGLE, wrap ? 'bg-white/15 text-white' : 'text-neutral-400 hover:bg-white/10 hover:text-white')}
      >
        <ArrowUDownLeft size={13} />
      </button>
    </>
  )
}

function CodeBlockView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  const language: string | null = props.node.attrs.language || null
  const filename: string = props.node.attrs.filename || ''
  const languages = React.useMemo(() => {
    const list: string[] = (props.extension.options as any).lowlight?.listLanguages?.() ?? []
    return [...new Set(list)].sort((a, b) => (LANGUAGE_LABELS[a] || a).localeCompare(LANGUAGE_LABELS[b] || b))
  }, [props.extension.options])
  const [draftName, setDraftName] = React.useState(filename)
  React.useEffect(() => setDraftName(filename), [filename])

  if (!isEditable) {
    return (
      <NodeViewWrapper data-lhb-keep="" className="lh-code-block group/code relative">
        {filename && (
          <div className="flex items-center gap-1.5 rounded-t-lg bg-neutral-800 px-3 py-1.5 text-[12px] text-neutral-300" contentEditable={false}>
            <FileCode size={13} />
            <span className="truncate font-mono">{filename}</span>
          </div>
        )}
        <pre className={filename ? '!mt-0 !rounded-t-none' : undefined} {...codePreProps(props.node.attrs, props.node.textContent)}>
          <NodeViewContent<'code'> as="code" className={language ? `language-${language}` : undefined} />
        </pre>
        <div className="absolute end-2 top-2 opacity-0 transition-opacity group-hover/code:opacity-100 focus-within:opacity-100 max-md:opacity-100" style={filename ? { top: 2 } : undefined}>
          <CopyButton text={props.node.textContent} className="bg-neutral-800/80" notify />
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper data-lhb-keep="" className="lh-code-block relative">
      <div
        contentEditable={false}
        className="flex items-center gap-2 rounded-t-lg bg-neutral-800 px-2 py-1 text-[12px] text-neutral-300"
      >
        <FileCode size={13} className="ms-1 flex-none text-neutral-500" />
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => {
            const next = draftName.trim().slice(0, 120)
            if (next !== filename) props.updateAttributes({ filename: next || null })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          placeholder={t('editor.blocks_v2.filename_placeholder', 'File name (optional)')}
          aria-label={t('editor.blocks_v2.filename', 'File name')}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-neutral-200 outline-none placeholder:text-neutral-500"
        />
        <select
          value={language || ''}
          onChange={(e) => props.updateAttributes({ language: e.target.value || null })}
          aria-label={t('editor.blocks_v2.language', 'Language')}
          className="h-6 max-w-[40%] rounded-md bg-neutral-700/70 px-1.5 text-[11px] text-neutral-200 outline-none hover:bg-neutral-700"
        >
          <option value="">{t('editor.blocks_v2.auto_detect', 'Auto-detect')}</option>
          {languages.map((lang) => (
            <option key={lang} value={lang}>{LANGUAGE_LABELS[lang] || lang}</option>
          ))}
        </select>
        <LineOptions attrs={props.node.attrs} update={props.updateAttributes} />
        <CopyButton text={props.node.textContent} />
      </div>
      <pre className="!mt-0 !rounded-t-none" {...codePreProps(props.node.attrs, props.node.textContent)}>
        <NodeViewContent<'code'> as="code" className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  )
}

// ─── line numbers and highlighted lines (editor, preview, DynamicCanva) ────

const codeLinesKey = new PluginKey('lhCodeLines')

function lineStart(n: number, numbers: boolean, highlighted: boolean) {
  return () => {
    const el = document.createElement('span')
    el.className = 'lh-code-line-start'
    el.setAttribute('aria-hidden', 'true')
    el.contentEditable = 'false'
    if (numbers) el.setAttribute('data-ln', String(n))
    if (highlighted) el.setAttribute('data-hl', 'true')
    return el
  }
}

function codeLineDecorations(doc: PMNode, typeName: string): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== typeName) return true
    const lines = codeLines(node.textContent, node.attrs)
    if (lines.length) {
      const { showLineNumbers } = codeLineOptions(node.attrs)
      for (const line of lines) {
        decorations.push(
          Decoration.widget(pos + 1 + line.offset, lineStart(line.n, showLineNumbers, line.highlighted), {
            side: -1,
            ignoreSelection: true,
            key: `lh-ln-${line.n}-${showLineNumbers ? 1 : 0}-${line.highlighted ? 1 : 0}`,
          }),
        )
      }
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

export function codeLinesPlugin(typeName: string) {
  return new Plugin({
    key: codeLinesKey,
    state: {
      init: (_, { doc }) => codeLineDecorations(doc, typeName),
      apply: (tr, set) => (tr.docChanged ? codeLineDecorations(tr.doc, typeName) : set),
    },
    props: {
      decorations(state) {
        return codeLinesKey.getState(state)
      },
    },
  })
}

/** Drop-in replacement for CodeBlockLowlight (same node name and attrs). */
export const LHCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...CODE_BLOCK_EXTRA_ATTRS,
    }
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), codeLinesPlugin(this.name)]
  },
  addNodeView() {
    return lhNodeView(CodeBlockView)
  },
})

export default LHCodeBlock
