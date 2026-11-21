'use client'
/* One column of a columns block. Loads with the schema (no editor UI). */
import React from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'

export function ColumnView() {
  return (
    <NodeViewWrapper className="lh-column">
      <NodeViewContent className="lh-column-body" />
    </NodeViewWrapper>
  )
}
