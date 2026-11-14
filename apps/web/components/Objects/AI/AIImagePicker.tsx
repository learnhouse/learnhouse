import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditCost, OutOfCreditsNotice } from '@components/Objects/AI/CreditCost'
import { useAICreditPrices, useRefreshAICredits } from '@components/Hooks/useAICredits'
import { isOutOfCreditsError } from '@services/ai/credits'
import { ArrowUpRight, CircleNotch, ClockCounterClockwise, Image, ImageBroken, Trash, X } from '@phosphor-icons/react'
import { AIAccentLine, AIButton, AIMark, AIThinking, aiSurface } from './AIBrand'
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

const PROMPT_IDEAS = [
  'ai.image_picker.idea_lightbulb',
  'ai.image_picker.idea_robot',
  'ai.image_picker.idea_data_science',
  'ai.image_picker.idea_history',
]

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
  // ai-credits: the price before, what the last image used after.
  const { estimate } = useAICreditPrices()
  const refreshCredits = useRefreshAICredits()
  const [lastCredits, setLastCredits] = useState<number | null>(null)
  const [outOfCredits, setOutOfCredits] = useState(false)
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
    setOutOfCredits(false)
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
      const message = typeof detail === 'string' ? detail : t('ai.image_picker.generation_failed')
      if (!res.success || !res.data?.file_id || !res.data?.ai_generation_uuid) {
        if (isOutOfCreditsError(detail, res.status)) setOutOfCredits(true)
        else setError(message)
        return
      }
      setLastCredits(res.credits ?? null)
      refreshCredits()
      const url = aiImageUrl(org.org_uuid, res.data.file_id)
      setItems((prev) => [
        { ai_generation_uuid: res.data.ai_generation_uuid, file_id: res.data.file_id, url, prompt: prompt.trim() },
        ...prev,
      ])
      setSessionUuid(res.data.session_uuid)
      setRefineFrom(null)
      setPrompt('')
    } catch {
      setError(t('ai.image_picker.generation_failed'))
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
      setError(t('ai.image_picker.use_failed'))
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
      {t('ai.image_picker.use')}
    </button>
  )

  const modalContent = (
    <div className="flex flex-col h-full bg-white">
      <AIAccentLine />
      {/* Tabs */}
      <div className={`flex items-center gap-1.5 px-5 pt-4 pb-3 border-b border-neutral-100 ${aiSurface.header}`}>
        {tabBtn('generate', <AIMark size={16} alt="" />, t('ai.image_picker.tab_generate'))}
        {tabBtn('history', <ClockCounterClockwise weight="duotone" size={15} />, t('ai.image_picker.tab_history'))}
      </div>

      {tab === 'generate' ? (
        <>
          {/* Prompt composer */}
          <div className="px-5 pt-4 pb-3 space-y-3">
            {refineFrom && (
              <div className="flex items-center gap-2 text-xs text-neutral-600 bg-neutral-100 rounded-full ps-1.5 pe-2.5 py-1 w-fit">
                <img src={refineFrom.url} alt="" className="w-6 h-6 rounded-full object-cover" />
                <span className="font-medium">{t('ai.image_picker.refining')}</span>
                <button onClick={() => setRefineFrom(null)} className="text-neutral-400 hover:text-neutral-700">
                  <X weight="duotone" size={13} />
                </button>
              </div>
            )}
            <div className={aiSurface.prompt}>
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                autoFocus
                placeholder={
                  refineFrom
                    ? t('ai.image_picker.placeholder_refine')
                    : t('ai.image_picker.placeholder_new')
                }
                className="w-full p-3.5 bg-transparent resize-none focus:outline-hidden text-sm placeholder:text-neutral-400"
              />
              <div className="flex items-center justify-between px-3 pb-3">
                <span className="text-[11px] text-neutral-400 hidden sm:block">{t('ai.image_picker.shortcut_hint')}</span>
                <CreditCost credits={estimate('image_generation')} className="ms-auto me-3" />
                <AIButton
                  onClick={handleGenerate}
                  disabled={!prompt.trim()}
                  loading={generating}
                  className="ms-auto"
                >
                  {generating ? t('ai.image_picker.generating') : refineFrom ? t('ai.image_picker.refine') : t('ai.image_picker.generate')}
                </AIButton>
              </div>
            </div>
            {error && (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            {outOfCredits && <OutOfCreditsNotice />}
            {!generating && lastCredits != null && <CreditCost kind="used" credits={lastCredits} />}
          </div>

          {/* Results / empty / loading */}
          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {generating && (
              <div className="relative w-full aspect-[4/3] rounded-2xl bg-gradient-to-br from-violet-50 to-neutral-100 overflow-hidden mb-4 ring-1 ring-inset ring-violet-600/10">
                <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <AIMark size={36} pulse alt="" />
                  <AIThinking label={t('ai.image_picker.creating')} />
                </div>
              </div>
            )}

            {!generating && items.length === 0 ? (
              <div className="flex flex-col items-center text-center gap-3 py-10">
                <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center text-neutral-400">
                  <Image weight="duotone" size={22} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-neutral-700">{t('ai.image_picker.empty_title')}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">{t('ai.image_picker.empty_hint')}</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-md">
                  {PROMPT_IDEAS.map((idea) => (
                    <button
                      key={idea}
                      onClick={() => setPrompt(t(idea))}
                      className="px-3 py-1.5 bg-neutral-100 rounded-full hover:bg-neutral-200 transition-colors text-xs text-neutral-600"
                    >
                      {t(idea)}
                    </button>
                  ))}
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
                          {t('ai.image_picker.image_failed')}
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
                            <AIMark size={15} alt="" /> {t('ai.image_picker.refine')}
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
              <CircleNotch weight="duotone" size={15} className="animate-spin" /> {t('common.loading')}
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-2 py-12 text-neutral-400">
              <ClockCounterClockwise weight="duotone" size={22} />
              <p className="text-sm">{t('ai.image_picker.no_history')}</p>
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
                          title={t('common.delete')}
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
      dialogTitle={t('ai.image_picker.dialog_title')}
      icon={<AIMark size={32} alt="" />}
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
