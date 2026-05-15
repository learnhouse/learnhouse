'use client'

import React, { useEffect, useMemo, useState } from 'react'

import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  HelpCircle,
  ListPlus,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X as XIcon,
} from 'lucide-react'
import { GlobeStand } from '@phosphor-icons/react'

// Editable course-skeleton card driven by ``structure.proposal`` events.
// The user can rename chapters / activities inline, reorder via the
// up/down buttons, add / remove rows, then Apply to provision the
// course. Refine sends a free-text instruction for the LLM to rewrite
// the whole tree.

export type EditableActivity = {
  id: string
  name: string
  kind: 'dynamic' | 'quiz' | 'video' | 'pdf' | 'assignment'
}

export type EditableChapter = {
  id: string
  name: string
  activities: EditableActivity[]
}

export type EditableStructure = {
  title?: string
  description?: string
  audience?: string
  chapters: EditableChapter[]
}

const ACTIVITY_KIND_META: Record<EditableActivity['kind'], { Icon: React.ComponentType<{ size?: number; className?: string }>; label: string; color: string }> = {
  dynamic: { Icon: FileText, label: 'Page', color: 'text-sky-300' },
  quiz: { Icon: HelpCircle, label: 'Quiz', color: 'text-amber-300' },
  video: { Icon: Play, label: 'Video', color: 'text-rose-300' },
  pdf: { Icon: FileText, label: 'PDF', color: 'text-emerald-300' },
  assignment: { Icon: ClipboardList, label: 'Assignment', color: 'text-violet-300' },
}

interface Props {
  tree: Record<string, any>
  busy?: boolean
  // Apply provisions the course. Parent owns the actual API call so it
  // can route through /chat (with the edited tree embedded) or a
  // dedicated apply endpoint.
  onApply: (structure: EditableStructure) => void
  onRefine: (instruction: string) => void
  onDismiss?: () => void
  applied?: boolean
}

export default function StructureProposalCard({
  tree,
  busy,
  onApply,
  onRefine,
  onDismiss,
  applied,
}: Props) {
  const initial = useMemo(() => normalize(tree), [tree])
  const [structure, setStructure] = useState<EditableStructure>(initial)
  // Re-normalize when the parent passes a fresh tree (refine round-trip).
  useEffect(() => {
    setStructure(normalize(tree))
  }, [tree])

  const [refineOpen, setRefineOpen] = useState(false)
  const [refineText, setRefineText] = useState('')

  const totalActivities = structure.chapters.reduce(
    (sum, ch) => sum + ch.activities.length,
    0,
  )

  const renameChapter = (id: string, name: string) =>
    setStructure((s) => ({
      ...s,
      chapters: s.chapters.map((c) => (c.id === id ? { ...c, name } : c)),
    }))
  const renameActivity = (chapterId: string, actId: string, name: string) =>
    setStructure((s) => ({
      ...s,
      chapters: s.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, activities: c.activities.map((a) => (a.id === actId ? { ...a, name } : a)) }
          : c,
      ),
    }))
  const setActivityKind = (chapterId: string, actId: string, kind: EditableActivity['kind']) =>
    setStructure((s) => ({
      ...s,
      chapters: s.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, activities: c.activities.map((a) => (a.id === actId ? { ...a, kind } : a)) }
          : c,
      ),
    }))
  const moveChapter = (id: string, dir: -1 | 1) =>
    setStructure((s) => {
      const idx = s.chapters.findIndex((c) => c.id === id)
      if (idx < 0) return s
      const target = idx + dir
      if (target < 0 || target >= s.chapters.length) return s
      const next = [...s.chapters]
      const [it] = next.splice(idx, 1)
      next.splice(target, 0, it)
      return { ...s, chapters: next }
    })
  const moveActivity = (chapterId: string, actId: string, dir: -1 | 1) =>
    setStructure((s) => ({
      ...s,
      chapters: s.chapters.map((c) => {
        if (c.id !== chapterId) return c
        const idx = c.activities.findIndex((a) => a.id === actId)
        if (idx < 0) return c
        const target = idx + dir
        if (target < 0 || target >= c.activities.length) return c
        const acts = [...c.activities]
        const [it] = acts.splice(idx, 1)
        acts.splice(target, 0, it)
        return { ...c, activities: acts }
      }),
    }))
  const addChapter = () =>
    setStructure((s) => ({
      ...s,
      chapters: [
        ...s.chapters,
        {
          id: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: '',
          activities: [],
        },
      ],
    }))
  const removeChapter = (id: string) =>
    setStructure((s) => ({
      ...s,
      chapters: s.chapters.filter((c) => c.id !== id),
    }))
  const addActivity = (chapterId: string) =>
    setStructure((s) => ({
      ...s,
      chapters: s.chapters.map((c) =>
        c.id === chapterId
          ? {
              ...c,
              activities: [
                ...c.activities,
                {
                  id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  name: '',
                  kind: 'dynamic' as const,
                },
              ],
            }
          : c,
      ),
    }))
  const removeActivity = (chapterId: string, actId: string) =>
    setStructure((s) => ({
      ...s,
      chapters: s.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, activities: c.activities.filter((a) => a.id !== actId) }
          : c,
      ),
    }))

  return (
    <div className="mt-3 rounded-xl ring-1 ring-inset ring-white/10 bg-black/20 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-gradient-to-b from-violet-500/10 to-transparent">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-violet-300/80 mb-1">
          <GlobeStand size={12} weight="duotone" className="text-violet-300" />
          Course skeleton
        </div>
        {applied ? (
          <h2 className="text-[15px] font-semibold text-emerald-200">
            ✓ Provisioned · {structure.title || 'Untitled'}
          </h2>
        ) : (
          <input
            value={structure.title || ''}
            onChange={(e) =>
              setStructure((s) => ({ ...s, title: e.target.value }))
            }
            placeholder="Course title"
            className="w-full bg-transparent text-[18px] font-bold text-white tracking-tight leading-snug placeholder:text-white/30 outline-none focus:bg-white/[0.04] rounded px-1 -mx-1"
          />
        )}
        {!applied && (
          <textarea
            value={structure.description || ''}
            onChange={(e) =>
              setStructure((s) => ({ ...s, description: e.target.value }))
            }
            placeholder="Short description (optional)"
            rows={1}
            className="w-full mt-1 resize-none bg-transparent text-[13px] text-white/70 leading-relaxed placeholder:text-white/30 outline-none focus:bg-white/[0.04] rounded px-1 -mx-1"
          />
        )}
        <div className="flex items-center gap-3 mt-2 text-[11px] text-white/45">
          <span>
            <span className="font-semibold text-white/70">{structure.chapters.length}</span>{' '}
            {structure.chapters.length === 1 ? 'chapter' : 'chapters'}
          </span>
          <span className="w-px h-3 bg-white/15" />
          <span>
            <span className="font-semibold text-white/70">{totalActivities}</span>{' '}
            {totalActivities === 1 ? 'activity' : 'activities'}
          </span>
        </div>
      </div>

      <ul className="divide-y divide-white/[0.04]">
        {structure.chapters.map((ch, ci) => (
          <li key={ch.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center text-[10px] font-bold w-5 h-5 rounded-md bg-white/10 text-white/70 flex-none">
                {ci + 1}
              </span>
              <input
                value={ch.name}
                onChange={(e) => renameChapter(ch.id, e.target.value)}
                placeholder="Chapter name"
                disabled={applied || busy}
                className="flex-1 min-w-0 bg-transparent text-[14px] font-semibold text-white/90 placeholder:text-white/30 outline-none focus:bg-white/[0.04] rounded px-1 -mx-1"
              />
              {!applied && (
                <div className="flex items-center gap-0.5 flex-none">
                  <button
                    type="button"
                    onClick={() => moveChapter(ch.id, -1)}
                    disabled={ci === 0 || busy}
                    title="Move up"
                    className="p-1 text-white/40 hover:text-white/80 disabled:opacity-25"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveChapter(ch.id, 1)}
                    disabled={ci === structure.chapters.length - 1 || busy}
                    title="Move down"
                    className="p-1 text-white/40 hover:text-white/80 disabled:opacity-25"
                  >
                    <ChevronDown size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeChapter(ch.id)}
                    disabled={busy}
                    title="Remove chapter"
                    className="p-1 text-white/40 hover:text-rose-300"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
            {ch.activities.length > 0 && (
              <ul className="mt-2 pl-7 space-y-1">
                {ch.activities.map((a, ai) => {
                  const meta = ACTIVITY_KIND_META[a.kind]
                  const Icon = meta.Icon
                  return (
                    <li key={a.id} className="flex items-center gap-1.5 group">
                      <Icon size={12} className={`${meta.color} flex-none`} />
                      <input
                        value={a.name}
                        onChange={(e) => renameActivity(ch.id, a.id, e.target.value)}
                        placeholder="Activity name"
                        disabled={applied || busy}
                        className="flex-1 min-w-0 bg-transparent text-[13px] text-white/80 placeholder:text-white/30 outline-none focus:bg-white/[0.04] rounded px-1 -mx-0.5"
                      />
                      {!applied && (
                        <>
                          <select
                            value={a.kind}
                            onChange={(e) =>
                              setActivityKind(ch.id, a.id, e.target.value as EditableActivity['kind'])
                            }
                            disabled={busy}
                            className="text-[10px] bg-white/[0.04] ring-1 ring-inset ring-white/10 rounded-md px-1 py-0.5 text-white/70 outline-none focus:ring-violet-400/30"
                          >
                            <option value="dynamic" className="bg-zinc-900">Page</option>
                            <option value="quiz" className="bg-zinc-900">Quiz</option>
                            <option value="video" className="bg-zinc-900">Video</option>
                            <option value="pdf" className="bg-zinc-900">PDF</option>
                            <option value="assignment" className="bg-zinc-900">Assignment</option>
                          </select>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => moveActivity(ch.id, a.id, -1)}
                              disabled={ai === 0 || busy}
                              className="p-1 text-white/35 hover:text-white/80 disabled:opacity-25"
                            >
                              <ChevronUp size={10} />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveActivity(ch.id, a.id, 1)}
                              disabled={ai === ch.activities.length - 1 || busy}
                              className="p-1 text-white/35 hover:text-white/80 disabled:opacity-25"
                            >
                              <ChevronDown size={10} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeActivity(ch.id, a.id)}
                              disabled={busy}
                              className="p-1 text-white/35 hover:text-rose-300"
                            >
                              <XIcon size={10} />
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {!applied && (
              <button
                type="button"
                onClick={() => addActivity(ch.id)}
                disabled={busy}
                className="mt-1.5 ml-7 inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-violet-300 transition-colors"
              >
                <Plus size={11} />
                Add activity
              </button>
            )}
          </li>
        ))}
      </ul>

      {!applied && (
        <div className="border-t border-white/10 px-4 py-2">
          <button
            type="button"
            onClick={addChapter}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[12px] text-white/55 hover:text-violet-200 transition-colors"
          >
            <ListPlus size={12} />
            Add chapter
          </button>
        </div>
      )}

      {!applied && (
        <div className="border-t border-white/10 bg-white/[0.02] px-4 py-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onApply(structure)}
            disabled={busy || structure.chapters.length === 0 || !structure.title?.trim()}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-white/5 disabled:text-white/30 text-white ring-1 ring-inset ring-violet-400/30 disabled:ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {busy ? 'Provisioning…' : 'Apply structure'}
          </button>
          <button
            type="button"
            onClick={() => setRefineOpen((v) => !v)}
            disabled={busy}
            className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/70 hover:text-white/90 ring-1 ring-inset ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Pencil size={12} />
            Refine
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/55 hover:text-white/80 ring-1 ring-inset ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
            >
              <XIcon size={12} />
              Discard
            </button>
          )}
          {refineOpen && (
            <form
              className="w-full flex items-center gap-2 mt-2"
              onSubmit={(e) => {
                e.preventDefault()
                const text = refineText.trim()
                if (!text) return
                onRefine(text)
                setRefineText('')
                setRefineOpen(false)
              }}
            >
              <input
                autoFocus
                type="text"
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                placeholder="Tighter scope, beginner audience, more practice…"
                className="flex-1 rounded-lg bg-black/30 ring-1 ring-inset ring-white/10 focus:ring-violet-400/40 outline-none text-sm text-white px-2 py-1.5"
              />
              <button
                type="submit"
                className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white ring-1 ring-inset ring-violet-400/30 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
              >
                <RotateCcw size={12} />
                Send
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

function normalize(tree: Record<string, any>): EditableStructure {
  const chaptersRaw = Array.isArray(tree?.chapters) ? tree.chapters : []
  const chapters: EditableChapter[] = chaptersRaw.map((c: any, ci: number) => {
    const activitiesRaw = Array.isArray(c?.activities) ? c.activities : []
    const activities: EditableActivity[] = activitiesRaw.map((a: any, ai: number) => ({
      id: `a-${ci}-${ai}-${Math.random().toString(36).slice(2, 6)}`,
      name: a?.name || a?.title || '',
      kind: normalizeKind(a?.kind),
    }))
    return {
      id: `ch-${ci}-${Math.random().toString(36).slice(2, 6)}`,
      name: c?.name || `Chapter ${ci + 1}`,
      activities,
    }
  })
  return {
    title: tree?.topic || tree?.title || '',
    description: tree?.description || '',
    audience: tree?.audience,
    chapters,
  }
}

function normalizeKind(raw: unknown): EditableActivity['kind'] {
  if (typeof raw === 'string') {
    const v = raw.toLowerCase()
    if (v === 'dynamic' || v === 'quiz' || v === 'video' || v === 'pdf' || v === 'assignment') {
      return v
    }
  }
  return 'dynamic'
}
