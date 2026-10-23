import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, CircleNotch, ClockCounterClockwise, Image, ImageBroken, MagicWand, Sparkle, Trash, X } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  generateAIImage,
  fetchAIImageHistory,
  deleteAIImageHistory,
  fetchAIImageFile,
  aiImageUrl,
  AIImageHistoryItem,
} from '@services/ai/generation'

// Shared AI image generator (Google "nano banana"). Drops into every image-upload
// surface via the same contract as UnsplashImagePicker (onSelect(url)). Upload
// surfaces can additionally pass onSelectFile to receive a ready-to-upload File
// fetched SAME-ORIGIN via the API (avoids the cross-origin CORS fetch that left
// the surface stuck "processing").
export interface AIImagePickerProps {
  onSelect: (_imageUrl: string) => void
  onSelectFile?: (_file: File) => void | Promise<void>
  onClose: () => void
  isOpen?: boolean
}

interface GeneratedItem {
  ai_generation_uuid: string
  file_id: string
  url: string
  prompt: string
  failed?: boolean
}

const PROMPT_IDEA_KEYS = ['idea_1', 'idea_2', 'idea_3', 'idea_4']

const AIImagePicker: React.FC<AIImagePickerProps> = ({ onSelect, onSelectFile, onClose, isOpen = true }) => {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [tab, setTab] = useState<'generate' | 'history'>('generate')
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<GeneratedItem[]>([])
  const [sessionUuid, setSessionUuid] = useState<string | undefined>(undefined)
  const [refineFrom, setRefineFrom] = useState<GeneratedItem | null>(null)
  const [usingKey, setUsingKey] = useState<string | null>(null)
  const promptRef = React.useRef<HTMLTextAreaElement>(null)

  const stageRefine = (item: GeneratedItem) => {
    setRefineFrom(item)
    setPrompt('')
    requestAnimationFrame(() => promptRef.current?.focus())
  }

  const [history, setHistory] = useState<AIImageHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    if (!org?.id || !access_token) return
    setHistoryLoading(true)
    const res = await fetchAIImageHistory(org.id, access_token)
    if (res.success && Array.isArray(res.data)) setHistory(res.data)
    setHistoryLoading(false)
  }, [org?.id, access_token])

  useEffect(() => {
    if (tab === 'history') loadHistory()
  }, [tab, loadHistory])

  const handleGenerate = async () => {
    if (!prompt.trim() || generating || !org?.id) return
    setGenerating(true)
    setError(null)
    try {
      const res = await generateAIImage(
        {
          org_id: org.id,
          prompt: prompt.trim(),
          session_uuid: sessionUuid,
          // Refine by file_id: the backend reads the source image from storage
          // (no cross-origin fetch), so refinement is reliable.
          source_file_id: refineFrom?.file_id,
        },
        access_token
      )
      // detail can be a string (our HTTPException) or an array (422); only show strings.
      const detail = res.data?.detail
      const message = typeof detail === 'string' ? detail : t('editor.ai.image.generation_failed')
      if (!res.success || !res.data?.file_id || !res.data?.ai_generation_uuid) {
        setError(message)
        return
      }
      const url = aiImageUrl(org.org_uuid, res.data.file_id)
      setItems((prev) => [
        { ai_generation_uuid: res.data.ai_generation_uuid, file_id: res.data.file_id, url, prompt: prompt.trim() },
        ...prev,
      ])
      setSessionUuid(res.data.session_uuid)
      setRefineFrom(null)
      setPrompt('')
    } catch {
      setError(t('editor.ai.image.generation_failed'))
    } finally {
      setGenerating(false)
    }
  }

  // Apply a picked image. When the caller needs an uploadable File (thumbnails,
  // avatars, logos), fetch the bytes SAME-ORIGIN via the API; otherwise hand back
  // the URL (editor image block stores it directly).
  const handleUse = async (key: string, fileId: string, url: string) => {
    if (!onSelectFile) {
      onSelect(url)
      onClose()
      return
    }
    try {
      setUsingKey(key)
      setError(null)
      const file = await fetchAIImageFile(org.id, fileId, access_token)
      await onSelectFile(file)
      onClose()
    } catch {
      setError(t('editor.ai.image.use_failed'))
    } finally {
      setUsingKey(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleGenerate()
    }
  }

  const handleDeleteHistory = async (uuid: string) => {
    if (!access_token) return
    await deleteAIImageHistory(uuid, access_token)
    setHistory((prev) => prev.filter((h) => h.ai_generation_uuid !== uuid))
  }

  const tabBtn = (id: 'generate' | 'history', icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`px-3.5 py-1.5 rounded-full text-sm font-medium flex items-center gap-1.5 transition-colors ${
        tab === id ? 'bg-neutral-900 text-white nice-shadow' : 'text-neutral-500 hover:bg-neutral-100'
      }`}
    >
      {icon} {label}
    </button>
  )

  const renderUseButton = (key: string, fileId: string, url: string) => (
    <button
      onClick={() => handleUse(key, fileId, url)}
      disabled={usingKey === key}
      className="px-3 py-1.5 rounded-lg bg-white text-neutral-900 text-sm font-medium flex items-center gap-1.5 nice-shadow disabled:opacity-60"
    >
      {usingKey === key ? <CircleNotch weight="duotone" size={15} className="animate-spin" /> : <ArrowUpRight weight="duotone" size={15} data-dir-flip />}
      {t('editor.ai.image.use')}
    </button>
  )

  const modalContent = (
    <div className="flex flex-col h-full bg-white">
      {/* Tabs */}
      <div className="flex items-center gap-1.5 px-5 pt-4 pb-3 border-b border-neutral-100">
        {tabBtn('generate', <MagicWand weight="duotone" size={15} />, t('editor.ai.image.tab_generate'))}
        {tabBtn('history', <ClockCounterClockwise weight="duotone" size={15} />, t('editor.ai.image.tab_history'))}
      </div>

      {tab === 'generate' ? (
        <>
          {/* Prompt composer */}
          <div className="px-5 pt-4 pb-3 space-y-3">
            {refineFrom && (
              <div className="flex items-center gap-2 text-xs text-neutral-600 bg-neutral-100 rounded-full ps-1.5 pe-2.5 py-1 w-fit">
                <img src={refineFrom.url} alt="" className="w-6 h-6 rounded-full object-cover" />
                <span className="font-medium">{t('editor.ai.image.refining_from')}</span>
                <button onClick={() => setRefineFrom(null)} className="text-neutral-400 hover:text-neutral-700">
                  <X weight="duotone" size={13} />
                </button>
              </div>
            )}
            <div className="rounded-2xl border border-neutral-200 focus-within:border-neutral-300 focus-within:ring-4 focus-within:ring-neutral-900/5 transition-all bg-neutral-50/50">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                autoFocus
                placeholder={
                  refineFrom
                    ? t('editor.ai.image.refine_placeholder')
                    : t('editor.ai.image.prompt_placeholder')
                }
                className="w-full p-3.5 bg-transparent resize-none focus:outline-hidden text-sm placeholder:text-neutral-400"
              />
              <div className="flex items-center justify-between px-3 pb-3">
                <span className="text-[11px] text-neutral-400 hidden sm:block">{t('editor.ai.image.generate_hint')}</span>
                <button
                  onClick={handleGenerate}
                  disabled={generating || !prompt.trim()}
                  className="ms-auto px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm font-medium flex items-center gap-2 nice-shadow disabled:opacity-40 transition-opacity hover:bg-neutral-800"
                >
                  {generating ? <CircleNotch weight="duotone" size={15} className="animate-spin" /> : <Sparkle weight="duotone" size={15} />}
                  {generating ? t('editor.ai.image.generating') : refineFrom ? t('editor.ai.image.refine') : t('editor.ai.image.generate')}
                </button>
              </div>
            </div>
            {error && (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* Results / empty / loading */}
          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {generating && (
              <div className="relative w-full aspect-[4/3] rounded-2xl bg-gradient-to-br from-neutral-100 to-neutral-200 overflow-hidden mb-4">
                <div className="absolute inset-0 animate-pulse" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-500">
                  <Sparkle weight="duotone" size={22} className="animate-pulse" />
                  <span className="text-sm font-medium">{t('editor.ai.image.creating')}</span>
                </div>
              </div>
            )}

            {!generating && items.length === 0 ? (
              <div className="flex flex-col items-center text-center gap-3 py-10">
                <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center text-neutral-400">
                  <Image weight="duotone" size={22} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-neutral-700">{t('editor.ai.image.empty_title')}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">{t('editor.ai.image.empty_subtitle')}</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-md">
                  {PROMPT_IDEA_KEYS.map((ideaKey) => {
                    const idea = t(`editor.ai.image.${ideaKey}`)
                    return (
                      <button
                        key={ideaKey}
                        onClick={() => setPrompt(idea)}
                        className="px-3 py-1.5 bg-neutral-100 rounded-full hover:bg-neutral-200 transition-colors text-xs text-neutral-600"
                      >
                        {idea}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {items.map((item) => (
                  <div key={item.ai_generation_uuid} className="group flex flex-col gap-1.5">
                    <div className="relative w-full pb-[75%] rounded-2xl overflow-hidden nice-shadow bg-neutral-100">
                      {item.failed ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[11px] text-neutral-400 px-2 text-center">
                          <ImageBroken weight="duotone" size={18} />
                          {t('editor.ai.image.failed_to_load')}
                        </div>
                      ) : (
                        <img
                          src={item.url}
                          alt={item.prompt}
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={() =>
                            setItems((prev) =>
                              prev.map((i) =>
                                i.ai_generation_uuid === item.ai_generation_uuid ? { ...i, failed: true } : i
                              )
                            )
                          }
                        />
                      )}
                      {!item.failed && (
                        <div className="absolute inset-0 bg-neutral-900/0 group-hover:bg-neutral-900/45 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                          {renderUseButton(item.ai_generation_uuid, item.file_id, item.url)}
                          <button
                            onClick={() => stageRefine(item)}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium flex items-center gap-1.5 nice-shadow"
                          >
                            <MagicWand weight="duotone" size={15} /> {t('editor.ai.image.refine')}
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-neutral-500 truncate px-0.5">{item.prompt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        // History tab
        <div className="flex-1 overflow-y-auto p-5">
          {historyLoading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-neutral-400 mt-8">
              <CircleNotch weight="duotone" size={15} className="animate-spin" /> {t('editor.ai.image.loading')}
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-2 py-12 text-neutral-400">
              <ClockCounterClockwise weight="duotone" size={22} />
              <p className="text-sm">{t('editor.ai.image.no_history')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {history.map((h) => {
                const url = aiImageUrl(org.org_uuid, h.file_id)
                return (
                  <div key={h.ai_generation_uuid} className="group flex flex-col gap-1.5">
                    <div className="relative w-full pb-[75%] rounded-2xl overflow-hidden nice-shadow bg-neutral-100">
                      <img src={url} alt={h.prompt} className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-neutral-900/0 group-hover:bg-neutral-900/45 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        {renderUseButton(h.ai_generation_uuid, h.file_id, url)}
                        <button
                          onClick={() => handleDeleteHistory(h.ai_generation_uuid)}
                          className="p-1.5 rounded-lg bg-neutral-900 text-white nice-shadow"
                          title={t('editor.ai.image.delete')}
                        >
                          <Trash weight="duotone" size={15} />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-neutral-500 truncate px-0.5">{h.prompt}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <Modal
      dialogTitle={t('editor.ai.image.dialog_title')}
      dialogContent={modalContent}
      onOpenChange={onClose}
      isDialogOpen={isOpen}
      minWidth="lg"
      minHeight="lg"
      customHeight="h-[82vh]"
      noPadding
    />
  )
}

export default AIImagePicker
