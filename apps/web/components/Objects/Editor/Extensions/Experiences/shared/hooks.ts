'use client'
/*
 React hooks shared by the Experiences blocks.

 - useLiveAttrs: read attrs, commit partial changes against the LIVE node in
   the editor state (the Scenarios commit pattern), so an edit never
   overwrites a collaborator's change that landed after our render.
 - useExperienceMemory: learner state in localStorage, per activity + block.
 - useExperienceEditable: whether the block is being authored.
 - useEnsureBlockId: give a block without a blockId one (editor only).
 - usePrefersReducedMotion.
*/
import React from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { newBlockId } from './utils'

type Attrs = Record<string, any>
type NodeViewLike = Pick<NodeViewProps, 'node' | 'editor' | 'getPos' | 'updateAttributes'>

function sameJSON(a: unknown, b: unknown) {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** The node as it is in the editor state right now (falls back to props). */
export function readLiveAttrs(props: NodeViewLike): Attrs {
  try {
    const pos = typeof props.getPos === 'function' ? props.getPos() : undefined
    const live = typeof pos === 'number' ? props.editor?.state?.doc?.nodeAt(pos) : null
    if (live && live.type?.name === props.node.type.name) return live.attrs
  } catch {
    // Static renderer / destroyed view: the props are all there is.
  }
  return props.node.attrs
}

export type CommitPatch<A> = Partial<A> | ((_live: A) => Partial<A>)

/**
 * `[attrs, commit]`. `commit(partial)` or `commit(live => partial)` reads the
 * live node attrs first and writes only the keys that changed, in one
 * transaction (one undo step).
 */
export function useLiveAttrs<A extends Attrs = Attrs>(props: NodeViewLike): [A, (_patch: CommitPatch<A>) => void] {
  const { node, editor, getPos, updateAttributes } = props
  const propsRef = React.useRef(props)
  React.useLayoutEffect(() => {
    propsRef.current = props
  })
  const commit = React.useCallback(
    (patch: CommitPatch<A>) => {
      const live = readLiveAttrs(propsRef.current) as A
      const partial = typeof patch === 'function' ? patch(live) : patch
      if (!partial) return
      const changed: Attrs = {}
      for (const [key, value] of Object.entries(partial)) {
        if (!sameJSON(value, live[key])) changed[key] = value
      }
      if (Object.keys(changed).length) propsRef.current.updateAttributes(changed)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, getPos, updateAttributes],
  )
  return [node.attrs as A, commit]
}

/** True while authoring (editor), false for learners and static renders. */
export function useExperienceEditable(props?: Pick<NodeViewProps, 'editor'>): boolean {
  const ctx = useEditorProvider() as { isEditable?: boolean } | null
  if (ctx && typeof ctx.isEditable === 'boolean') return ctx.isEditable
  if (props?.editor && typeof props.editor.isEditable === 'boolean') return props.editor.isEditable
  return false
}

/** Fill an empty blockId once, while authoring. */
export function useEnsureBlockId(props: NodeViewLike, editable: boolean) {
  const blockId = props.node.attrs.blockId
  React.useEffect(() => {
    if (!editable || blockId) return
    // Defer: never dispatch during the editor's own render pass.
    const id = window.setTimeout(() => {
      try {
        if (!readLiveAttrs(props).blockId) props.updateAttributes({ blockId: newBlockId() })
      } catch {
        // ignore (node gone)
      }
    }, 0)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, blockId])
}

/** The activity uuid a block view lives in, from its extension options. */
export function activityUuidOf(source?: unknown): string {
  if (typeof source === 'string') return source
  const s = source as { extension?: { options?: { activity?: { activity_uuid?: string } } } } | undefined
  const fromOptions = s?.extension?.options?.activity?.activity_uuid
  if (fromOptions) return String(fromOptions)
  if (typeof window !== 'undefined') {
    const m = window.location?.pathname?.match(/\/activity\/([^/?#]+)/)
    if (m) return m[1].startsWith('activity_') ? m[1] : `activity_${m[1]}`
  }
  return 'local'
}

export const EXPERIENCE_STORAGE_PREFIX = 'lh:exp:'

export function experienceStorageKey(activityUuid: string, blockId: string, key: string) {
  return `${EXPERIENCE_STORAGE_PREFIX}${activityUuid}:${blockId}:${key}`
}

export interface ExperienceMemory {
  read: <T>(_key: string, _fallback: T) => T
  write: (_key: string, _value: unknown) => void
  remove: (_key: string) => void
}

/**
 * Learner state in localStorage under `lh:exp:<activityUuid>:<blockId>:<key>`.
 * Pass the node view props (or an activity uuid) as `source` so the activity
 * comes from the block's extension options; without it the activity is read
 * from the URL. Every access is wrapped: blocked storage just means nothing
 * is remembered. A block without a blockId remembers nothing.
 */
export function useExperienceMemory(blockId: string | null | undefined, source?: unknown): ExperienceMemory {
  const activityUuid = activityUuidOf(source)
  return React.useMemo<ExperienceMemory>(() => {
    const keyOf = (key: string) => (blockId ? experienceStorageKey(activityUuid, blockId, key) : null)
    return {
      read<T>(key: string, fallback: T): T {
        const k = keyOf(key)
        if (!k) return fallback
        try {
          const raw = window.localStorage.getItem(k)
          return raw == null ? fallback : (JSON.parse(raw) as T)
        } catch {
          return fallback
        }
      },
      write(key: string, value: unknown) {
        const k = keyOf(key)
        if (!k) return
        try {
          window.localStorage.setItem(k, JSON.stringify(value))
        } catch {
          // storage full or blocked
        }
      },
      remove(key: string) {
        const k = keyOf(key)
        if (!k) return
        try {
          window.localStorage.removeItem(k)
        } catch {
          // blocked
        }
      },
    }
  }, [activityUuid, blockId])
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    let mq: MediaQueryList | null = null
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    } catch {
      return
    }
    const update = () => setReduced(Boolean(mq?.matches))
    update()
    mq.addEventListener?.('change', update)
    return () => mq?.removeEventListener?.('change', update)
  }, [])
  return reduced
}
