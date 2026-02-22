'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()

  return (
    <div
      className="flex items-center gap-[7px] rounded-[15px] px-3 py-2.5 nice-shadow pointer-events-auto"
      style={{
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <ToolTip content={t('boards.zoom.zoom_out')}>
        <div onClick={onZoomOut} className="editor-tool-btn">
          <ZoomOut size={13} />
        </div>
      </ToolTip>
      <div
        onClick={onZoomReset}
        className="editor-tool-btn cursor-pointer"
        style={{ minWidth: 36, fontSize: 10, fontWeight: 700 }}
      >
        {Math.round(zoom * 100)}%
      </div>
      <ToolTip content={t('boards.zoom.zoom_in')}>
        <div onClick={onZoomIn} className="editor-tool-btn">
          <ZoomIn size={13} />
        </div>
      </ToolTip>
    </div>
  )
}
