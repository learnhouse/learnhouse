'use client'
/*
 Inline formula and button group while their views' chunks load (see
 ../../lazyView). Both are the views' own learner markup: the LaTeX as code
 (what InlineMathView shows until KaTeX loads) and the row of buttons.
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { buttonGroupAlignmentOf, buttonGroupJustify } from '../upgradesModel'

export function InlineMathFallback({ node }: NodeViewProps) {
  const latex = String(node.attrs.latex ?? '')
  return (
    <NodeViewWrapper as="span" className="lh-inline-math" data-latex={latex}>
      <code className="lh-inline-math-raw">{latex || '∅'}</code>
    </NodeViewWrapper>
  )
}

export function ButtonGroupFallback({ node }: NodeViewProps) {
  const alignment = buttonGroupAlignmentOf(node.attrs)
  return (
    <NodeViewWrapper className="lh-button-group" data-alignment={alignment}>
      <NodeViewContent className="lh-button-group-row" style={{ justifyContent: buttonGroupJustify(alignment) }} />
    </NodeViewWrapper>
  )
}
