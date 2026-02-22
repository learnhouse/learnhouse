'use client'

import React, { forwardRef, useCallback } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import NodeActions from './NodeActions'
import type { Editor } from '@tiptap/core'
import { useBoardSelection } from '../BoardSelectionContext'

interface BoardBlockWrapperProps {
  // TipTap passthrough
  selected: boolean
  deleteNode: () => void
  editor?: Editor
  getPos?: () => number
  // Position (ALWAYS on NodeViewWrapper for CSS transitions)
  x: number
  y: number
  width?: number
  height?: number
  // Appearance
  className?: string
  bgColor?: string
  zIndex?: number
  styled?: boolean
  selectedRing?: boolean
  // Behavior
  stopWheel?: boolean
  includeNodeActions?: boolean
  style?: React.CSSProperties
  children: React.ReactNode
  // Extra HTML attributes (e.g. data-playground-block)
  [key: string]: any
}

const BoardBlockWrapper = forwardRef<HTMLDivElement, BoardBlockWrapperProps>(function BoardBlockWrapper({
  selected,
  deleteNode,
  editor,
  getPos,
  x,
  y,
  width,
  height,
  className = '',
  bgColor,
  zIndex,
  styled = true,
  selectedRing = true,
  stopWheel = false,
  includeNodeActions = true,
  style,
  children,
  ...rest
}, ref) {
  const { isSelected: isMultiSelected, selectSingle, toggleSelect, selectedPositions, deleteSelected } = useBoardSelection()

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
  }, [])

  const handleBlockClick = useCallback((e: React.MouseEvent) => {
    if (!getPos) return
    const pos = getPos()
    if (e.shiftKey) {
      toggleSelect(pos)
    } else {
      selectSingle(pos)
    }
  }, [getPos, toggleSelect, selectSingle])

  const multiSelected = getPos ? isMultiSelected(getPos()) : false
  const showRing = selectedRing && (selected || multiSelected)

  const styledClass = styled ? 'rounded-xl nice-shadow bg-white' : ''
  const ringClass = showRing ? 'ring-2 ring-blue-400' : ''

  const positionStyle: React.CSSProperties = {
    left: x,
    top: y,
    ...(width != null && { width }),
    ...(height != null && { height }),
    zIndex: zIndex != null ? zIndex : 1,
    ...(bgColor != null && { backgroundColor: bgColor }),
    ...style,
  }

  return (
    <NodeViewWrapper
      as="div"
      ref={ref}
      className={`absolute group ${styledClass} ${ringClass} ${className}`}
      style={positionStyle}
      onClick={handleBlockClick}
      {...(stopWheel ? { onWheel: handleWheel } : {})}
      {...rest}
    >
      {includeNodeActions && (
        <NodeActions
          selected={selected || multiSelected}
          deleteNode={selectedPositions.size > 1 ? deleteSelected : deleteNode}
          editor={editor}
          getPos={getPos}
          multiCount={selectedPositions.size > 1 ? selectedPositions.size : undefined}
        />
      )}
      {children}
    </NodeViewWrapper>
  )
})

export default BoardBlockWrapper
