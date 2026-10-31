'use client'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from '@components/Contexts/AuthContext'
import { DynamicReach, getDynamicReach } from '@services/courses/dynamicContent'

const ReachContext = createContext<DynamicReach | null>(null)

// The rules of every conditional block, in document order: when it changes,
// the reach counts are stale.
function rulesSignature(editor: any): string {
  const parts: string[] = []
  editor?.state?.doc?.descendants((node: any) => {
    if (node.type.name === 'conditionalBlock') parts.push(JSON.stringify(node.attrs.rules))
  })
  return parts.join('|')
}

// Counts, for the editor, how many enrolled learners each conditional block
// reaches. Refetched (debounced) whenever a block or its rules change.
export function DynamicReachProvider(props: { editor: any; activityUuid: string; children: React.ReactNode }) {
  const { editor, activityUuid } = props
  const { accessToken } = useAuth()
  const [reach, setReach] = useState<DynamicReach | null>(null)

  useEffect(() => {
    if (!editor || !accessToken) return
    let lastSignature: string | null = null
    let timer: number | undefined
    let cancelled = false

    const refresh = () => {
      const signature = rulesSignature(editor)
      if (signature === lastSignature) return
      lastSignature = signature
      if (!signature) {
        setReach(null)
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        const res = await getDynamicReach(activityUuid, editor.getJSON(), accessToken)
        if (!cancelled && res.success) setReach(res.data)
      }, 1200)
    }

    refresh()
    editor.on('update', refresh)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      editor.off('update', refresh)
    }
  }, [editor, activityUuid, accessToken])

  return <ReachContext.Provider value={reach}>{props.children}</ReachContext.Provider>
}

// This block's reach: its index among conditional blocks, in the same
// (descendants) order the API counts them in.
export function useBlockReach(editor: any, getPos: unknown): { matched: number; learners: number; truncated: boolean } | null {
  const reach = useContext(ReachContext)
  if (!reach || !editor || typeof getPos !== 'function') return null
  const pos = (getPos as () => number | undefined)()
  if (pos === undefined) return null
  let index = 0
  editor.state.doc.descendants((node: any, nodePos: number) => {
    if (nodePos >= pos) return false
    if (node.type.name === 'conditionalBlock') index++
  })
  const matched = reach.blocks[index]
  if (matched === undefined) return null
  return { matched, learners: reach.learners, truncated: reach.truncated }
}
