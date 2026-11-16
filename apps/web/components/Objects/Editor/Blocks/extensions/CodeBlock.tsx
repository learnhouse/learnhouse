'use client'
/*
 Code block with a language picker, an optional file name and a copy button.

 Same node (`codeBlock`) and same stored attrs as before plus an optional
 `filename`. Learners see the code exactly as before; a copy button appears on
 hover (floating, so it doesn't move anything), and a file name header only
 when the author set one.
*/
import React from 'react'
import { NodeViewContent, NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Check, Copy, FileCode } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { CODE_BLOCK_EXTRA_ATTRS } from '../schema/blockAttrs'
import { cn } from '@/lib/utils'

const LANGUAGE_LABELS: Record<string, string> = {
  plaintext: 'Plain text', bash: 'Bash', shell: 'Shell', c: 'C', cpp: 'C++', csharp: 'C#', css: 'CSS', go: 'Go',
  java: 'Java', javascript: 'JavaScript', json: 'JSON', kotlin: 'Kotlin', markdown: 'Markdown', php: 'PHP',
  python: 'Python', ruby: 'Ruby', rust: 'Rust', sql: 'SQL', swift: 'Swift', typescript: 'TypeScript',
  xml: 'HTML / XML', yaml: 'YAML', r: 'R', scss: 'SCSS', diff: 'Diff', dockerfile: 'Dockerfile',
}

function CopyButton({ text, className }: { text: string; className?: string }) {
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
          setTimeout(() => setCopied(false), 1400)
        }).catch(() => {})
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
        <pre className={filename ? '!mt-0 !rounded-t-none' : undefined}>
          <NodeViewContent<'code'> as="code" className={language ? `language-${language}` : undefined} />
        </pre>
        <div className="absolute end-2 top-2 opacity-0 transition-opacity group-hover/code:opacity-100 max-md:opacity-100" style={filename ? { top: 2 } : undefined}>
          <CopyButton text={props.node.textContent} className="bg-neutral-800/80" />
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
        <CopyButton text={props.node.textContent} />
      </div>
      <pre className="!mt-0 !rounded-t-none">
        <NodeViewContent<'code'> as="code" className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  )
}

/** Drop-in replacement for CodeBlockLowlight (same node name and attrs). */
export const LHCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...CODE_BLOCK_EXTRA_ATTRS,
    }
  },
  addNodeView() {
    return lhNodeView(CodeBlockView)
  },
})

export default LHCodeBlock
