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
import { FileCode } from '@phosphor-icons/react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { CODE_BLOCK_EXTRA_ATTRS } from '../schema/blockAttrs'
import { codeLineOptions, codeLines, codePreAttrs } from './codeBlockModel'
import { CopyButton } from './CopyButton'
import { lazyView } from '../../Extensions/Plus/lazyView'

// The editor's header bar (file name, language, line options) is editor UI:
// learners never load it. Until it has, a bar of the same height.
const CodeBlockEditorBar = lazyView<NodeViewProps>('CodeBlockEditorBar', () => import('./CodeBlockEditorBar'), () => (
  <div contentEditable={false} className="h-9 rounded-t-lg bg-neutral-800" />
))

/** <pre> props for the line options (none for a block without them). */
export function codePreProps(attrs: any, text: string): Record<string, any> {
  const { style, ...data } = codePreAttrs(attrs, text)
  if (!style) return data
  const [name, value] = style.split(':')
  return { ...data, style: { [name]: value } }
}

function CodeBlockView(props: NodeViewProps) {
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  const language: string | null = props.node.attrs.language || null
  const filename: string = props.node.attrs.filename || ''

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
      <CodeBlockEditorBar {...props} />
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
