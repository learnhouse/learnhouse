'use client'
/*
 One tab panel. Small and free of editor UI, so it loads with the schema;
 the tab bar (TabsView) is a lazy chunk.
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { useHydrated } from '../base'

/** One panel. Its title is only shown in the no-JS / print form (CSS). */
export function TabItemView(props: NodeViewProps) {
  const { t } = useTranslation()
  const hydrated = useHydrated()
  const title = typeof props.node.attrs.title === 'string' ? props.node.attrs.title.trim() : ''
  return (
    <NodeViewWrapper className="lh-tab-panel" role={hydrated ? 'tabpanel' : undefined} aria-label={title || undefined}>
      <h3 className="lh-tab-title" contentEditable={false}>
        {title || t('activities.tabs.tab', 'Tab')}
      </h3>
      <NodeViewContent className="lh-tab-body" />
    </NodeViewWrapper>
  )
}
