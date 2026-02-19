'use client'

import React, { useState, useEffect } from 'react'
import { Save } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updateBoard } from '@services/boards/boards'
import toast from 'react-hot-toast'
import { mutate } from 'swr'

interface BoardGeneralTabProps {
  board: any
  boardUuid: string
  boardKey: string | null
}

function BoardGeneralTab({ board, boardUuid, boardKey }: BoardGeneralTabProps) {
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
      toast.success('Board updated')
      if (boardKey) mutate(boardKey)
    } catch {
      toast.error('Failed to update board')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <div className="h-6"></div>
      <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
          <h1 className="font-bold text-lg sm:text-xl text-gray-800">General</h1>
          <h2 className="text-gray-500 text-xs sm:text-sm">Basic board information</h2>
        </div>
        <div className="px-3 sm:px-5 space-y-4 py-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Description</label>
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
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default BoardGeneralTab
