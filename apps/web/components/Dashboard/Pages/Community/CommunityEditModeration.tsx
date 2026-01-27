'use client'
import React, { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Shield, AlertTriangle, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCommunity, useCommunityDispatch } from '@components/Contexts/CommunityContext'
import { updateCommunity } from '@services/communities/communities'
import { revalidateTags } from '@services/utils/ts/requests'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import toast from 'react-hot-toast'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'

const CommunityEditModeration: React.FC = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const org = useOrg() as any
  const communityState = useCommunity()
  const dispatch = useCommunityDispatch()
  const community = communityState?.community
  const accessToken = session?.data?.tokens?.access_token
  const inputRef = useRef<HTMLInputElement>(null)
  const batchInputRef = useRef<HTMLTextAreaElement>(null)

  const [words, setWords] = useState<string[]>([])
  const [newWord, setNewWord] = useState('')
  const [batchWords, setBatchWords] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  // Initialize words when community loads
  useEffect(() => {
    if (community) {
      setWords(community.moderation_words || [])
    }
  }, [community])

  // Track changes
  useEffect(() => {
    if (!community) return
    const originalWords = community.moderation_words || []
    const wordsChanged =
      words.length !== originalWords.length || words.some((w, i) => w !== originalWords[i])
    setHasChanges(wordsChanged)
  }, [words, community])

  if (!community) return null

  const handleAddWord = () => {
    const trimmedWord = newWord.trim().toLowerCase()

    if (!trimmedWord) return

    if (words.includes(trimmedWord)) {
      setError(t('dashboard.courses.communities.moderation.word_exists_error'))
      return
    }

    setWords([...words, trimmedWord])
    setNewWord('')
    setError(null)
    inputRef.current?.focus()
  }

  const handleBatchAdd = () => {
    if (!batchWords.trim()) return

    const newWordsToAdd = batchWords
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0)
      .filter((w) => !words.includes(w))

    if (newWordsToAdd.length === 0) {
      setError(t('dashboard.courses.communities.moderation.all_words_exist_error'))
      return
    }

    const uniqueNewWords = [...new Set(newWordsToAdd)]
    setWords([...words, ...uniqueNewWords])
    setBatchWords('')
    setError(null)
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
    const loadingToast = toast.loading(t('dashboard.courses.communities.moderation.toasts.saving'))

    try {
      await updateCommunity(community.community_uuid, { moderation_words: words }, accessToken)
      await revalidateTags(['communities'], org.slug)
      mutate(`${getAPIUrl()}communities/${community.community_uuid}`)
      if (dispatch) {
        dispatch({ type: 'setCommunity', payload: { ...community, moderation_words: words } })
      }
      toast.success(t('dashboard.courses.communities.moderation.toasts.save_success'), { id: loadingToast })
      router.refresh()
    } catch (err) {
      setError(t('dashboard.courses.communities.moderation.toasts.save_error'))
      toast.error(t('dashboard.courses.communities.moderation.toasts.save_error'), { id: loadingToast })
      console.error('Failed to update moderation settings:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
      <div className="flex flex-col gap-0">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">{t('dashboard.courses.communities.moderation.title')}</h1>
          <h2 className="text-gray-500 text-md">
            {t('dashboard.courses.communities.moderation.subtitle')}
          </h2>
        </div>

        <div className="mx-5 my-5 space-y-6">
          {/* Info */}
          <div className="flex gap-3 p-4 bg-amber-50 border border-amber-100 rounded-lg">
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">{t('dashboard.courses.communities.moderation.info_title')}</p>
              <p className="text-amber-700 mt-0.5">
                {t('dashboard.courses.communities.moderation.info_description')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left column - Add words */}
            <div className="space-y-6">
              {/* Add single word */}
              <div>
                <Label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('dashboard.courses.communities.moderation.add_word_label')}
                </Label>
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    type="text"
                    value={newWord}
                    onChange={(e) => {
                      setNewWord(e.target.value)
                      setError(null)
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={t('dashboard.courses.communities.moderation.add_word_placeholder')}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={handleAddWord}
                    disabled={!newWord.trim()}
                    className="bg-gray-900 hover:bg-gray-800"
                  >
                    <Plus size={16} className="mr-2" />
                    {t('dashboard.courses.communities.moderation.add_button')}
                  </Button>
                </div>
              </div>

              {/* Batch add */}
              <div>
                <Label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('dashboard.courses.communities.moderation.batch_add_label')}
                </Label>
                <p className="text-xs text-gray-500 mb-2">
                  {t('dashboard.courses.communities.moderation.batch_add_description')}
                </p>
                <textarea
                  ref={batchInputRef}
                  value={batchWords}
                  onChange={(e) => {
                    setBatchWords(e.target.value)
                    setError(null)
                  }}
                  placeholder={t('dashboard.courses.communities.moderation.batch_add_placeholder')}
                  className="w-full min-h-[100px] px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
                <Button
                  type="button"
                  onClick={handleBatchAdd}
                  disabled={!batchWords.trim()}
                  className="mt-2 bg-gray-900 hover:bg-gray-800"
                >
                  <Plus size={16} className="mr-2" />
                  {t('dashboard.courses.communities.moderation.add_all_button')}
                </Button>
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}
            </div>

            {/* Right column - Words list */}
            <div>
              <Label className="block text-sm font-medium text-gray-700 mb-2">
                {t('dashboard.courses.communities.moderation.blocked_words_label')} ({words.length})
              </Label>
              {words.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-gray-200 rounded-lg">
                  <Shield size={32} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">{t('dashboard.courses.communities.moderation.no_blocked_words')}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('dashboard.courses.communities.moderation.no_blocked_words_description')}
                  </p>
                </div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {words.map((word, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 group"
                    >
                      <span className="text-sm text-gray-700 font-mono">{word}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveWord(word)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Save button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={isSubmitting || !hasChanges}
              className="bg-black text-white hover:bg-black/90"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  {t('common.saving')}
                </>
              ) : (
                t('common.save_changes')
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CommunityEditModeration
