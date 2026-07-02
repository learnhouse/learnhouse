import React, { useCallback, useEffect, useState } from 'react'
import { Sparkles, Wand2, History, ArrowUpRight, RefreshCw, X, Trash2 } from 'lucide-react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  generateAIImage,
  fetchAIImageHistory,
  deleteAIImageHistory,
  aiImageUrl,
  AIImageHistoryItem,
} from '@services/ai/generation'

// Shared, Unsplash-style AI image generator (Google "nano banana"). Drops into
// every image-upload surface via the SAME contract as UnsplashImagePicker, so
// callers can wire it in identically: onSelect receives an absolute image URL.
export interface AIImagePickerProps {
  onSelect: (_imageUrl: string) => void
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
  'A minimalist illustration of a lightbulb, soft gradients',
  'A friendly 3D robot tutor, isometric, pastel colors',
  'An abstract geometric banner about data science',
  'A watercolor landscape for a history lesson',
]

async function urlToBase64(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return undefined
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return undefined
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(undefined)
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

const AIImagePicker: React.FC<AIImagePickerProps> = ({ onSelect, onClose, isOpen = true }) => {
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
      let source_image_base64: string | undefined
      if (refineFrom) {
        source_image_base64 = await urlToBase64(refineFrom.url)
        if (!source_image_base64) {
          setError('Could not load the source image to refine. Please try again.')
          return
        }
      }
      const res = await generateAIImage(
        {
          org_id: org.id,
          prompt: prompt.trim(),
          session_uuid: sessionUuid,
          source_image_base64,
        },
        access_token
      )
      // detail can be a string (our HTTPException) or an array (422) — only show strings.
      const detail = res.data?.detail
      const message = typeof detail === 'string' ? detail : 'Image generation failed. Please try again.'
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
      setError('Image generation failed. Please try again.')
    } finally {
      setGenerating(false)
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

  const modalContent = (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-3">
        <button
          onClick={() => setTab('generate')}
          className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
            tab === 'generate' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'
          }`}
        >
          <Wand2 size={15} /> Generate
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
            tab === 'history' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'
          }`}
        >
          <History size={15} /> History
        </button>
      </div>

      {tab === 'generate' ? (
        <>
          {/* Prompt composer */}
          <div className="p-4 space-y-3">
            {refineFrom && (
              <div className="flex items-center gap-2 text-xs text-neutral-600 bg-neutral-100 rounded-lg px-2.5 py-1.5 w-fit">
                <img src={refineFrom.url} alt="" className="w-6 h-6 rounded object-cover" />
                <span>Refining from this image</span>
                <button onClick={() => setRefineFrom(null)} className="text-neutral-400 hover:text-neutral-700">
                  <X size={13} />
                </button>
              </div>
            )}
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder={
                  refineFrom
                    ? 'Describe how to change the image…'
                    : 'Describe the image you want to generate…'
                }
                className="w-full p-3 pr-28 border border-neutral-200 rounded-xl resize-none focus:outline-hidden focus:ring-2 focus:ring-neutral-900/10 text-sm"
              />
              <button
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
                className="absolute right-2 bottom-2 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm flex items-center gap-1.5 nice-shadow disabled:opacity-40 transition-opacity"
              >
                {generating ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                {generating ? 'Generating' : 'Generate'}
              </button>
            </div>
            {items.length === 0 && !generating && (
              <div className="flex flex-wrap gap-2">
                {PROMPT_IDEAS.map((idea) => (
                  <button
                    key={idea}
                    onClick={() => setPrompt(idea)}
                    className="px-2.5 py-1 bg-neutral-100 rounded-lg hover:bg-neutral-200 nice-shadow transition-colors text-xs text-neutral-600"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="text-xs text-rose-500">{error}</p>}
            <p className="text-[11px] text-neutral-400">
              Powered by Google nano banana. Generating an image uses AI credits.
            </p>
          </div>

          {/* Generated thread */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {generating && (
              <div className="w-full aspect-video rounded-xl bg-neutral-100 animate-pulse mb-4" />
            )}
            <div className="grid grid-cols-2 gap-4">
              {items.map((item) => (
                <div key={item.ai_generation_uuid} className="group flex flex-col gap-1.5">
                  <div className="relative w-full pb-[75%] rounded-xl overflow-hidden nice-shadow bg-neutral-100">
                    {item.failed ? (
                      <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-400 px-2 text-center">
                        Image failed to load
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
                      <div className="absolute inset-0 bg-neutral-900/0 group-hover:bg-neutral-900/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => {
                            onSelect(item.url)
                            onClose()
                          }}
                          className="px-3 py-1.5 rounded-lg bg-white text-neutral-900 text-sm flex items-center gap-1 nice-shadow"
                        >
                          <ArrowUpRight size={15} /> Use
                        </button>
                        <button
                          onClick={() => setRefineFrom(item)}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm flex items-center gap-1 nice-shadow"
                        >
                          <Wand2 size={15} /> Refine
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-500 truncate">{item.prompt}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        // History tab
        <div className="flex-1 overflow-y-auto p-4">
          {historyLoading ? (
            <p className="text-center text-sm text-neutral-400 mt-6">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-center text-sm text-neutral-400 mt-6">No generated images yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {history.map((h) => {
                const url = aiImageUrl(org.org_uuid, h.file_id)
                return (
                  <div key={h.ai_generation_uuid} className="group flex flex-col gap-1.5">
                    <div className="relative w-full pb-[75%] rounded-xl overflow-hidden nice-shadow">
                      <img src={url} alt={h.prompt} className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-neutral-900/0 group-hover:bg-neutral-900/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => {
                            onSelect(url)
                            onClose()
                          }}
                          className="px-3 py-1.5 rounded-lg bg-white text-neutral-900 text-sm flex items-center gap-1 nice-shadow"
                        >
                          <ArrowUpRight size={15} /> Use
                        </button>
                        <button
                          onClick={() => handleDeleteHistory(h.ai_generation_uuid)}
                          className="p-1.5 rounded-lg bg-neutral-900 text-white nice-shadow"
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-neutral-500 truncate">{h.prompt}</p>
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
      dialogTitle="Generate an image with AI"
      dialogContent={modalContent}
      onOpenChange={onClose}
      isDialogOpen={isOpen}
      minWidth="lg"
      minHeight="lg"
      customHeight="h-[80vh]"
      noPadding
    />
  )
}

export default AIImagePicker
