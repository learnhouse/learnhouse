'use client'
import React, { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, Shield, AlertTriangle, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Community, updateCommunity } from '@services/communities/communities'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog'

interface ModerationSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  community: Community
  orgSlug: string
}

export function ModerationSettingsModal({
  isOpen,
  onClose,
  community,
  orgSlug,
}: ModerationSettingsModalProps) {
  const session = useLHSession() as any
  const router = useRouter()
  const accessToken = session?.data?.tokens?.access_token
  const inputRef = useRef<HTMLInputElement>(null)

  const [words, setWords] = useState<string[]>(community.moderation_words || [])
  const [newWord, setNewWord] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setWords(community.moderation_words || [])
      setNewWord('')
      setError(null)
      setHasChanges(false)
    }
  }, [isOpen, community.moderation_words])

  // Track changes
  useEffect(() => {
    const originalWords = community.moderation_words || []
    const wordsChanged =
      words.length !== originalWords.length ||
      words.some((w, i) => w !== originalWords[i])
    setHasChanges(wordsChanged)
  }, [words, community.moderation_words])

  const handleAddWord = () => {
    const trimmedWord = newWord.trim().toLowerCase()

    if (!trimmedWord) return

    if (words.includes(trimmedWord)) {
      setError('This word is already in the list')
      return
    }

    setWords([...words, trimmedWord])
    setNewWord('')
    setError(null)
    inputRef.current?.focus()
  }

  const handleRemoveWord = (wordToRemove: string) => {
    setWords(words.filter((w) => w !== wordToRemove))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddWord()
    }
  }

  const handleSave = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      await updateCommunity(
        community.community_uuid,
        { moderation_words: words },
        accessToken
      )
      await revalidateTags(['communities'], orgSlug)
      router.refresh()
      onClose()
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        'Failed to save moderation settings.'
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield size={20} className="text-orange-500" />
            Content Moderation
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Info */}
          <div className="flex gap-3 p-3 bg-amber-50 border border-amber-100 rounded-lg">
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Blocked words</p>
              <p className="text-amber-700 mt-0.5">
                Discussions and replies containing these words will be blocked.
                Users will see an error message and their content will not be posted.
              </p>
            </div>
          </div>

          {/* Add word input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Add blocked word
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={newWord}
                onChange={(e) => {
                  setNewWord(e.target.value)
                  setError(null)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Enter a word or phrase..."
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none text-sm"
              />
              <button
                type="button"
                onClick={handleAddWord}
                disabled={!newWord.trim()}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium"
              >
                <Plus size={16} />
                Add
              </button>
            </div>
            {error && (
              <p className="text-red-500 text-sm mt-2">{error}</p>
            )}
          </div>

          {/* Words list */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Blocked words ({words.length})
            </label>
            {words.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-gray-200 rounded-lg">
                <Shield size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No blocked words yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Add words above to enable content moderation
                </p>
              </div>
            ) : (
              <div className="max-h-[200px] overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {words.map((word, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 group"
                  >
                    <span className="text-sm text-gray-700 font-mono">{word}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveWord(word)}
                      className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSubmitting || !hasChanges}
            className="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ModerationSettingsModal
