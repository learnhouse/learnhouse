'use client'

import React from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'

interface BoardZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
}

export default function BoardZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: BoardZoomControlsProps) {
  return (
    <div
      className="absolute top-[68px] right-4 z-20 flex items-center gap-[7px] rounded-[15px] px-3 py-2.5 nice-shadow"
      style={{
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <ToolTip content="Zoom out">
        <div onClick={onZoomOut} className="editor-tool-btn">
          <ZoomOut size={15} />
        </div>
      </ToolTip>
      <div
        onClick={onZoomReset}
        className="editor-tool-btn cursor-pointer"
        style={{ minWidth: 40, fontSize: 11, fontWeight: 700 }}
      >
        {Math.round(zoom * 100)}%
      </div>
      <ToolTip content="Zoom in">
        <div onClick={onZoomIn} className="editor-tool-btn">
          <ZoomIn size={15} />
        </div>
      </ToolTip>
    </div>
  )
}
