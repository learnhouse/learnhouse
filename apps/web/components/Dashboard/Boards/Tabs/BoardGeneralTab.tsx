'use client'

import React, { useState, useEffect } from 'react'
import { Save } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updateBoard } from '@services/boards/boards'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import { useTranslation } from 'react-i18next'

interface BoardGeneralTabProps {
  board: any
  boardUuid: string
  boardKey: string | null
}

function BoardGeneralTab({ board, boardUuid, boardKey }: BoardGeneralTabProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [name, setName] = useState(board.name)
  const [description, setDescription] = useState(board.description || '')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setName(board.name)
    setDescription(board.description || '')
  }, [board.name, board.description])

  const hasChanges = name !== board.name || description !== (board.description || '')

  const handleSave = async () => {
    if (!name.trim()) return
    setIsSaving(true)
    try {
      await updateBoard(boardUuid, { name, description }, access_token)
      toast.success(t('boards.general.board_updated'))
      if (boardKey) mutate(boardKey)
    } catch {
      toast.error(t('boards.general.board_updated_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <div className="h-6"></div>
      <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
          <h1 className="font-bold text-lg sm:text-xl text-gray-800">{t('boards.general.title')}</h1>
          <h2 className="text-gray-500 text-xs sm:text-sm">{t('boards.general.description')}</h2>
        </div>
        <div className="px-3 sm:px-5 space-y-4 py-3">
          <div>
            <label className="text-sm font-medium text-gray-700">{t('boards.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">{t('boards.description')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
              rows={3}
            />
          </div>
          {hasChanges && (
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={isSaving || !name.trim()}
                className="flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                <Save size={14} />
                {isSaving ? t('boards.general.saving') : t('boards.general.save_changes')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default BoardGeneralTab
