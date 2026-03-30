'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft } from 'lucide-react'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { getUriWithOrg } from '@services/config/config'

interface BoardTopBarProps {
  boardName: string
  orgslug: string
}

export default function BoardTopBar({
  boardName,
  orgslug,
}: BoardTopBarProps) {
  const { t } = useTranslation()

  return (
    <div className="absolute top-4 left-4 z-20 pointer-events-none board-backbar">
      {/* Left group: back + logo + title */}
      <div
        className="flex items-center gap-2 rounded-xl px-2.5 py-2 nice-shadow pointer-events-auto"
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <ToolTip content={t('boards.back_to_boards')}>
          <Link href={getUriWithOrg(orgslug, '/boards')}>
            <div className="editor-tool-btn">
              <ArrowLeft size={15} />
            </div>
          </Link>
        </ToolTip>

        <Link href={getUriWithOrg(orgslug, '/boards')}>
          <div className="bg-black rounded-md w-[25px] h-[25px] flex items-center justify-center hover:opacity-80 transition-opacity">
            <Image
              src="/lrn.svg"
              alt="LearnHouse"
              width={14}
              height={14}
              className="invert"
            />
          </div>
        </Link>

        <span className="text-sm font-bold text-neutral-800 truncate max-w-[220px]">
          {boardName}
        </span>
      </div>
    </div>
  )
}
