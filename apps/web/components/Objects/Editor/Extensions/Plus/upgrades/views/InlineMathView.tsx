'use client'
/*
 Inline formula (inlineMath). KaTeX renders it, the same library as the
 math block; until KaTeX has loaded (or if the LaTeX can't be parsed) the
 LaTeX shows as code. Authors click a formula to edit it in a small popover.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Sigma, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { BlockPopover, CommitInput, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import { deleteBlock } from '../../../../Blocks/nodeViewUtils'

type Katex = { renderToString: (_tex: string, _opts: Record<string, unknown>) => string }

let katexModule: Katex | null = null
let katexLoading: Promise<Katex | null> | null = null

function loadKatex(): Promise<Katex | null> {
  if (katexModule) return Promise.resolve(katexModule)
  katexLoading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css').catch(() => null)])
    .then(([m]) => {
      katexModule = ((m as any).default ?? m) as Katex
      return katexModule
    })
    .catch(() => null)
  return katexLoading
}

function useKatex(): Katex | null {
  const [mod, setMod] = React.useState<Katex | null>(katexModule)
  React.useEffect(() => {
    if (mod) return
    let alive = true
    loadKatex().then((m) => alive && setMod(m))
    return () => {
      alive = false
    }
  }, [mod])
  return mod
}

function renderLatex(katex: Katex | null, latex: string): string | null {
  if (!katex || !latex.trim()) return null
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: false, output: 'htmlAndMathml', strict: 'ignore' })
  } catch {
    return null
  }
}

function Formula({ latex, katex }: { latex: string; katex: Katex | null }) {
  const html = React.useMemo(() => renderLatex(katex, latex), [katex, latex])
  if (html) return <span className="lh-inline-math-render" dangerouslySetInnerHTML={{ __html: html }} />
  return <code className="lh-inline-math-raw">{latex || '∅'}</code>
}

export default function InlineMathView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  const latex: string = String(props.node.attrs.latex ?? '')
  const katex = useKatex()
  const [open, setOpen] = React.useState(false)

  if (!isEditable) {
    return (
      <NodeViewWrapper as="span" className="lh-inline-math" data-latex={latex}>
        <Formula latex={latex} katex={katex} />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper as="span" className="lh-inline-math" data-latex={latex} data-selected={props.selected || undefined}>
      <BlockPopover
        open={open}
        onOpenChange={setOpen}
        align="start"
        width={320}
        title={
          <span className="inline-flex items-center gap-1.5">
            <Sigma size={13} weight="bold" />
            {t('editor.blocks_v2.inline_math.title', 'Inline formula')}
          </span>
        }
        trigger={
          <button
            type="button"
            className="lh-inline-math-trigger"
            aria-label={t('editor.blocks_v2.inline_math.edit', 'Edit formula {{latex}}', { latex })}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Formula latex={latex} katex={katex} />
          </button>
        }
      >
        <SettingsField
          label={t('editor.blocks_v2.inline_math.latex', 'LaTeX')}
          hint={t('editor.blocks_v2.inline_math.hint', 'For example \\frac{a}{b} or x^2. Type $…$ in text to make one.')}
        >
          <CommitInput
            value={latex}
            className="h-8 w-full rounded-lg bg-neutral-50 px-2 font-mono text-[13px] text-neutral-800 outline-none ring-1 ring-inset ring-neutral-200 focus:ring-2 focus:ring-sky-500/40"
            aria-label={t('editor.blocks_v2.inline_math.latex', 'LaTeX')}
            onCommit={(v) => {
              const next = v.trim()
              if (!next) deleteBlock(props)
              else props.updateAttributes({ latex: next.slice(0, 1000) })
            }}
            placeholder="x^2"
          />
        </SettingsField>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-neutral-500">
            <Formula latex={latex} katex={katex} />
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              deleteBlock(props)
            }}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-neutral-500 transition-colors hover:bg-rose-50 hover:text-rose-600 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
          >
            <Trash size={13} />
            {t('editor.blocks_v2.inline_math.remove', 'Remove')}
          </button>
        </div>
      </BlockPopover>
    </NodeViewWrapper>
  )
}
