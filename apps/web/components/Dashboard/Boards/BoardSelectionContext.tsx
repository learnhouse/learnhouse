'use client'

import React, { createContext, useContext, useCallback, useRef, useMemo } from 'react'
import type { Editor } from '@tiptap/core'

interface BoardSelectionContextValue {
  selectedPositions: Set<number>
  isSelected: (pos: number) => boolean
  selectSingle: (pos: number) => void
  toggleSelect: (pos: number) => void
  clearSelection: () => void
  selectAll: (positions: number[]) => void
  deleteSelected: () => void
}

const BoardSelectionContext = createContext<BoardSelectionContextValue | null>(null)

export function useBoardSelection(): BoardSelectionContextValue {
  const ctx = useContext(BoardSelectionContext)
  if (!ctx) throw new Error('useBoardSelection must be used within BoardSelectionProvider')
  return ctx
}

interface BoardSelectionProviderProps {
  editor: Editor
  selectedPositions: Set<number>
  setSelectedPositions: React.Dispatch<React.SetStateAction<Set<number>>>
  children: React.ReactNode
}

export function BoardSelectionProvider({
  editor,
  selectedPositions,
  setSelectedPositions,
  children,
}: BoardSelectionProviderProps) {
  const editorRef = useRef(editor)
  editorRef.current = editor

  const isSelected = useCallback(
    (pos: number) => selectedPositions.has(pos),
    [selectedPositions]
  )

  const selectSingle = useCallback(
    (pos: number) => setSelectedPositions(new Set([pos])),
    [setSelectedPositions]
  )

  const toggleSelect = useCallback(
    (pos: number) =>
      setSelectedPositions((prev) => {
        const next = new Set(prev)
        if (next.has(pos)) next.delete(pos)
        else next.add(pos)
        return next
      }),
    [setSelectedPositions]
  )

  const clearSelection = useCallback(
    () => setSelectedPositions(new Set()),
    [setSelectedPositions]
  )

  const selectAll = useCallback(
    (positions: number[]) => setSelectedPositions(new Set(positions)),
    [setSelectedPositions]
  )

  const deleteSelected = useCallback(() => {
    const ed = editorRef.current
    if (!ed || selectedPositions.size === 0) return
    // Delete in reverse document order to keep earlier positions valid
    const sorted = Array.from(selectedPositions).sort((a, b) => b - a)
    ed.chain()
      .command(({ tr }) => {
        for (const pos of sorted) {
          const node = tr.doc.nodeAt(pos)
          if (node) {
            tr.delete(pos, pos + node.nodeSize)
          }
        }
        return true
      })
      .run()
    setSelectedPositions(new Set())
  }, [selectedPositions, setSelectedPositions])

  const value = useMemo<BoardSelectionContextValue>(
    () => ({
      selectedPositions,
      isSelected,
      selectSingle,
      toggleSelect,
      clearSelection,
      selectAll,
      deleteSelected,
    }),
    [selectedPositions, isSelected, selectSingle, toggleSelect, clearSelection, selectAll, deleteSelected]
  )

  return (
    <BoardSelectionContext.Provider value={value}>
      {children}
    </BoardSelectionContext.Provider>
  )
}
