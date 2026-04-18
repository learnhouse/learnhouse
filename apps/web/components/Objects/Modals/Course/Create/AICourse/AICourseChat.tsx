'use client'
import React from 'react'
import { Send, Loader2, Paperclip, X, Image as ImageIcon, Link as LinkIcon, FileText, Video } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import type { CoursePlanningMessage, Attachment } from '@services/ai/courseplanning'
import lrnaiIcon from 'public/lrnai_icon.png'

interface AICourseChatProps {
  messages: CoursePlanningMessage[]
  iterationCount: number
  maxIterations: number
  isLoading: boolean
  onSendMessage: (message: string, attachments?: Attachment[]) => void
  hasVideoAttachment?: boolean
  isCourseCreated?: boolean
}

const SUGGESTION_CHIPS = [
  { label: 'Web Development', prompt: 'Create a comprehensive web development course covering HTML, CSS, and JavaScript from basics to advanced topics' },
  { label: 'Data Science', prompt: 'Create a data science course covering Python, statistics, machine learning, and data visualization' },
  { label: 'Marketing', prompt: 'Create a digital marketing course covering SEO, social media marketing, content strategy, and analytics' },
  { label: 'Language', prompt: 'Create a language learning course with vocabulary, grammar, conversation practice, and cultural insights' },
  { label: 'Business', prompt: 'Create a business fundamentals course covering entrepreneurship, finance, marketing, and management' },
  { label: 'Design', prompt: 'Create a UI/UX design course covering design principles, Figma, user research, and prototyping' },
]

function AICourseChat({
  messages,
  iterationCount,
  maxIterations,
  isLoading,
  onSendMessage,
  hasVideoAttachment = false,
  isCourseCreated = false,
}: AICourseChatProps) {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = React.useState('')
  const [attachments, setAttachments] = React.useState<Attachment[]>([])
  const [showAttachMenu, setShowAttachMenu] = React.useState(false)
  const [youtubeUrl, setYoutubeUrl] = React.useState('')
  const [showYoutubeInput, setShowYoutubeInput] = React.useState(false)
  const [loadingDuration, setLoadingDuration] = React.useState(0)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const attachMenuRef = React.useRef<HTMLDivElement>(null)
  const loadingTimerRef = React.useRef<NodeJS.Timeout | null>(null)

  const canSendMessage = !isLoading && !isCourseCreated && iterationCount < maxIterations && (inputValue.trim() || attachments.length > 0)
  const isExhausted = iterationCount >= maxIterations
  const currentHasVideo = attachments.some(a => a.type === 'youtube') || hasVideoAttachment

  React.useEffect(() => {
    if (isLoading) {
      setLoadingDuration(0)
      loadingTimerRef.current = setInterval(() => setLoadingDuration(prev => prev + 1), 1000)
    } else {
      if (loadingTimerRef.current) { clearInterval(loadingTimerRef.current); loadingTimerRef.current = null }
      setLoadingDuration(0)
    }
    return () => { if (loadingTimerRef.current) clearInterval(loadingTimerRef.current) }
  }, [isLoading])

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target as Node)) {
        setShowAttachMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSendMessage) {
      onSendMessage(inputValue.trim(), attachments.length > 0 ? attachments : undefined)
      setInputValue('')
      setAttachments([])
    }
  }

  const handleSuggestionClick = (prompt: string) => {
    if (!isLoading && !isCourseCreated && iterationCount < maxIterations) {
      onSendMessage(prompt)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video' | 'file') => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach((file) => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const attachment: Attachment = { id, type, name: file.name, file }

      if (type === 'image' || type === 'video') {
        const reader = new FileReader()
        reader.onload = (event) => {
          setAttachments((prev) => prev.map((a) =>
            a.id === id ? { ...a, preview: event.target?.result as string } : a
          ))
        }
        reader.readAsDataURL(file)
      }

      setAttachments((prev) => [...prev, attachment])
    })

    setShowAttachMenu(false)
    e.target.value = ''
  }

  const handleYoutubeAdd = () => {
    if (!youtubeUrl.trim()) return
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i
    const match = youtubeUrl.match(youtubeRegex)

    if (match && match[1]) {
      const videoId = match[1]
      setAttachments((prev) => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'youtube',
        name: `YouTube: ${videoId}`,
        url: youtubeUrl.trim(),
        preview: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      }])
      setYoutubeUrl('')
      setShowYoutubeInput(false)
      setShowAttachMenu(false)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const getAttachmentIcon = (type: Attachment['type']) => {
    switch (type) {
      case 'image': return <ImageIcon className="w-3 h-3" />
      case 'youtube': return <LinkIcon className="w-3 h-3 text-red-400" />
      default: return <FileText className="w-3 h-3" />
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
        {/* Empty state with suggestions */}
        {messages.length === 0 && !isLoading && (
          <div className="space-y-4 pt-8">
            <div className="flex justify-center">
              <Image
                className="outline outline-1 outline-neutral-200/20 rounded-lg"
                width={28}
                src={lrnaiIcon}
                alt="AI"
              />
            </div>
            <p className="text-sm text-white/50 text-center">
              {t('courses.create.ai.chat_description')}
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => handleSuggestionClick(chip.prompt)}
                  className="px-4 py-1.5 text-xs font-semibold bg-white/5 text-white/40 rounded-xl hover:text-white/60 hover:bg-white/10 transition-all outline outline-1 outline-neutral-100/10 hover:outline-neutral-200/40 delay-75 ease-linear"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((message, index) => (
          <div
            key={index}
            className={cn("flex", message.role === 'user' ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                message.role === 'user'
                  ? "bg-purple-600/80 text-white rounded-ee-md"
                  : "bg-white/5 text-white/80 rounded-es-md ring-1 ring-inset ring-white/10"
              )}
            >
              {message.role === 'user' ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-white/50 font-medium">
                    {t('courses.create.ai.plan_generated')}
                  </p>
                  <p className="text-white/60 text-xs">
                    {t('courses.create.ai.plan_generated_hint')}
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white/5 rounded-2xl rounded-es-md px-4 py-3 ring-1 ring-inset ring-white/10 max-w-[85%]">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-white/70 font-medium">
                    {currentHasVideo && loadingDuration < 10
                      ? t('courses.create.ai.processing_video')
                      : t('courses.create.ai.generating')}
                  </span>
                  {loadingDuration >= 5 && (
                    <span className="text-xs text-white/40">
                      {currentHasVideo
                        ? t('courses.create.ai.video_processing_hint')
                        : t('courses.create.ai.still_working')}
                    </span>
                  )}
                  {loadingDuration >= 15 && currentHasVideo && (
                    <span className="text-xs text-amber-400/70">
                      {t('courses.create.ai.video_takes_time')}
                    </span>
                  )}
                </div>
              </div>
              {loadingDuration >= 3 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500/50 rounded-full animate-pulse"
                      style={{ width: `${Math.min(loadingDuration * 2, 95)}%`, transition: 'width 1s ease-out' }}
                    />
                  </div>
                  <span className="text-xs text-white/30 tabular-nums">
                    {loadingDuration}s
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-white/5 p-4">
        {isExhausted ? (
          <div className="text-center text-sm text-white/50 py-2">
            {t('courses.create.ai.max_iterations_reached')}
          </div>
        ) : isCourseCreated ? (
          <div className="text-center text-sm text-white/40 py-2">
            {t('courses.create.ai.content_step_info')}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Attachments preview */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 p-2 bg-white/5 rounded-xl ring-1 ring-inset ring-white/10">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="relative group flex items-center gap-2 px-2.5 py-2 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10 hover:ring-white/20 transition-all"
                  >
                    {attachment.preview ? (
                      <div className="w-10 h-10 rounded-md overflow-hidden bg-black/20 ring-1 ring-inset ring-white/10">
                        <img src={attachment.preview} alt={attachment.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-white/5 flex items-center justify-center text-white/40 ring-1 ring-inset ring-white/10">
                        {getAttachmentIcon(attachment.type)}
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-xs text-white/70 font-medium max-w-[100px] truncate">{attachment.name}</span>
                      {attachment.type === 'youtube' && (
                        <span className="text-[10px] text-red-400/70 flex items-center gap-1">
                          <Video className="w-3 h-3" /> YouTube
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      className="p-1 rounded-full bg-white/10 hover:bg-red-500/30 text-white/60 hover:text-red-300 transition-colors ms-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input container */}
            <div className="relative bg-white/[0.03] rounded-2xl ring-1 ring-inset ring-white/10 focus-within:ring-purple-500/30 transition-all">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  messages.length === 0
                    ? t('courses.create.ai.input_placeholder_initial')
                    : t('courses.create.ai.input_placeholder_iterate')
                }
                disabled={isLoading}
                rows={3}
                className={cn(
                  "w-full resize-none bg-transparent px-4 pt-4 pb-14",
                  "text-sm text-white placeholder:text-white/30",
                  "focus:outline-none",
                  isLoading ? "opacity-30" : ""
                )}
                style={{ minHeight: '100px', maxHeight: '200px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = Math.min(target.scrollHeight, 200) + 'px'
                }}
              />

              {/* Bottom toolbar */}
              <div className="absolute bottom-0 start-0 end-0 flex items-center justify-between p-3 border-t border-white/5">
                {/* Attachment button with menu */}
                <div className="relative" ref={attachMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowAttachMenu(!showAttachMenu)}
                    disabled={isLoading}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-xs font-medium",
                      !isLoading
                        ? "bg-white/5 text-white/50 hover:text-white/70 hover:bg-white/10 ring-1 ring-inset ring-white/10"
                        : "bg-white/5 text-white/20 cursor-not-allowed"
                    )}
                  >
                    <Paperclip className="w-4 h-4" />
                    <span>{t('courses.create.ai.attach') || 'Attach'}</span>
                  </button>

                  {/* Attachment menu */}
                  {showAttachMenu && (
                    <div className="absolute bottom-full start-0 mb-2 w-52 bg-gray-900 rounded-xl ring-1 ring-white/10 shadow-2xl overflow-hidden z-50">
                      {showYoutubeInput ? (
                        <div className="p-3 space-y-2">
                          <input
                            type="text"
                            value={youtubeUrl}
                            onChange={(e) => setYoutubeUrl(e.target.value)}
                            placeholder="Paste YouTube URL..."
                            className="w-full px-3 py-2.5 text-sm bg-white/5 rounded-lg text-white placeholder:text-white/30 ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-purple-500/30"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); handleYoutubeAdd() }
                            }}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setShowYoutubeInput(false)}
                              className="flex-1 px-3 py-2 text-xs font-medium text-white/50 hover:text-white/70 bg-white/5 rounded-lg transition-colors"
                            >
                              {t('common.cancel') || 'Cancel'}
                            </button>
                            <button
                              type="button"
                              onClick={handleYoutubeAdd}
                              className="flex-1 px-3 py-2 text-xs font-medium text-white bg-purple-500/50 hover:bg-purple-500/70 rounded-lg transition-colors"
                            >
                              {t('common.add') || 'Add'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="py-1">
                          <button
                            type="button"
                            onClick={() => {
                              const input = document.createElement('input')
                              input.type = 'file'; input.accept = 'image/*'; input.multiple = true
                              input.onchange = (e) => handleFileSelect(e as any, 'image')
                              input.click()
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/70 hover:bg-white/5 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                              <ImageIcon className="w-4 h-4 text-blue-400" />
                            </div>
                            <div className="text-start">
                              <span className="block font-medium">{t('courses.create.ai.attach_image') || 'Photo'}</span>
                              <span className="block text-xs text-white/40">PNG, JPG, GIF</span>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowYoutubeInput(true)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/70 hover:bg-white/5 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                              <Video className="w-4 h-4 text-red-400" />
                            </div>
                            <div className="text-start">
                              <span className="block font-medium">{t('courses.create.ai.attach_youtube') || 'YouTube Video'}</span>
                              <span className="block text-xs text-white/40">AI will analyze the video</span>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const input = document.createElement('input')
                              input.type = 'file'; input.accept = '.pdf,.doc,.docx,.txt,.md'; input.multiple = true
                              input.onchange = (e) => handleFileSelect(e as any, 'file')
                              input.click()
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/70 hover:bg-white/5 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                              <FileText className="w-4 h-4 text-yellow-400" />
                            </div>
                            <div className="text-start">
                              <span className="block font-medium">{t('courses.create.ai.attach_file') || 'Document'}</span>
                              <span className="block text-xs text-white/40">PDF, DOC, TXT</span>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Send button */}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSendMessage}
                  className={cn(
                    "flex items-center gap-2 px-4 py-1.5 rounded-lg transition-all text-xs font-medium",
                    canSendMessage
                      ? "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 ring-1 ring-inset ring-purple-500/30"
                      : "bg-white/5 text-white/30 cursor-not-allowed ring-1 ring-inset ring-white/10"
                  )}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('courses.create.ai.generating_short') || 'Generating...'}</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>{t('courses.create.ai.send') || 'Send'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {attachments.some(a => a.type === 'youtube') && (
              <p className="text-xs text-amber-400/60 text-center">
                {t('courses.create.ai.video_hint') || 'Videos may take 1-2 minutes to process'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default AICourseChat
