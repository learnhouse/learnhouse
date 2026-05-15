'use client'

import React, { useState } from 'react'

import { Check, Loader2, RotateCcw } from 'lucide-react'

// Final state for a successfully-applied pending edit. Shows what was
// changed + the new version number, and surfaces an Undo button when
// the backend captured an undo_token (today: renames + reorders).

interface Props {
  label: string
  versionAfter?: number
  undoToken?: string | null
  onUndo?: () => Promise<boolean> | void
}

export default function AppliedPill({ label, versionAfter, undoToken, onUndo }: Props) {
  const [undoing, setUndoing] = useState(false)
  const [undone, setUndone] = useState(false)

  const canUndo = !!undoToken && !!onUndo && !undone

  const handleUndo = async () => {
    if (!onUndo || undoing) return
    setUndoing(true)
    try {
      const result = await onUndo()
      if (result !== false) setUndone(true)
    } finally {
      setUndoing(false)
    }
  }

  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full ring-1 ring-inset ring-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs">
      <Check size={13} className="text-emerald-300" />
      <span className="font-semibold text-emerald-100">
        {undone ? 'Reverted' : 'Applied'}
      </span>
      <span className="text-emerald-200/80 truncate max-w-[18rem]">{label}</span>
      {versionAfter !== undefined && (
        <span className="text-[10px] text-emerald-300/70 font-mono">v{versionAfter}</span>
      )}
      {canUndo && (
        <button
          type="button"
          onClick={handleUndo}
          disabled={undoing}
          className="ml-1 inline-flex items-center gap-1 rounded-md border border-emerald-300/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100 transition-colors disabled:opacity-50"
        >
          {undoing ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
          Undo
        </button>
      )}
    </div>
  )
}
