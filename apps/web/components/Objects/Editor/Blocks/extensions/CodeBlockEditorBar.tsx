'use client'
/*
 The code block's header bar in the editor: file name, language, the line
 options (numbers, highlighted lines, wrapping) and copy. Editor only, so it
 is a chunk of its own (CodeBlock.tsx); learners get the plain header there.
*/
import React from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { ArrowUDownLeft, FileCode, Highlighter, ListNumbers } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { normalizeHighlightLines } from './codeBlockModel'
import { CopyButton } from './CopyButton'
import { cn } from '@/lib/utils'

const LANGUAGE_LABELS: Record<string, string> = {
  plaintext: 'Plain text', bash: 'Bash', shell: 'Shell', c: 'C', cpp: 'C++', csharp: 'C#', css: 'CSS', go: 'Go',
  java: 'Java', javascript: 'JavaScript', json: 'JSON', kotlin: 'Kotlin', markdown: 'Markdown', php: 'PHP',
  python: 'Python', ruby: 'Ruby', rust: 'Rust', sql: 'SQL', swift: 'Swift', typescript: 'TypeScript',
  xml: 'HTML / XML', yaml: 'YAML', r: 'R', scss: 'SCSS', diff: 'Diff', dockerfile: 'Dockerfile',
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

export default function CodeBlockEditorBar(props: NodeViewProps) {
  const { t } = useTranslation()
  const language: string | null = props.node.attrs.language || null
  const filename: string = props.node.attrs.filename || ''
  const languages = React.useMemo(() => {
    const list: string[] = (props.extension.options as any).lowlight?.listLanguages?.() ?? []
    return [...new Set(list)].sort((a, b) => (LANGUAGE_LABELS[a] || a).localeCompare(LANGUAGE_LABELS[b] || b))
  }, [props.extension.options])
  const [draftName, setDraftName] = React.useState(filename)
  React.useEffect(() => setDraftName(filename), [filename])
  return (
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
  )
}
