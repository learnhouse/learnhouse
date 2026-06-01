import React from 'react'
import { PaperPlaneTilt, CircleNotch, Sparkle, X } from '@phosphor-icons/react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import type { MagicBlockMessage } from './types'
import lrnaiIcon from 'public/lrnai_icon.png'
import { useTranslation } from 'react-i18next'

interface MagicBlockChatProps {
  messages: MagicBlockMessage[]
  isLoading: boolean
  onSendMessage: (message: string) => void
  styleReferenceActive?: boolean
  onClearStyleReference?: () => void
}

function MagicBlockChat({
  messages,
  isLoading,
  onSendMessage,
  styleReferenceActive = false,
  onClearStyleReference,
}: MagicBlockChatProps) {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = React.useState('')

  const SUGGESTION_CHIPS = [
    { label: t('editor.blocks.magic_block_content.suggestion_physics'), prompt: t('editor.blocks.magic_block_content.suggestion_physics_prompt') },
    { label: t('editor.blocks.magic_block_content.suggestion_chart'), prompt: t('editor.blocks.magic_block_content.suggestion_chart_prompt') },
    { label: t('editor.blocks.magic_block_content.suggestion_quiz'), prompt: t('editor.blocks.magic_block_content.suggestion_quiz_prompt') },
    { label: t('editor.blocks.magic_block_content.suggestion_memory'), prompt: t('editor.blocks.magic_block_content.suggestion_memory_prompt') },
    { label: t('editor.blocks.magic_block_content.suggestion_calculator'), prompt: t('editor.blocks.magic_block_content.suggestion_calculator_prompt') },
    { label: t('editor.blocks.magic_block_content.suggestion_timeline'), prompt: t('editor.blocks.magic_block_content.suggestion_timeline_prompt') },
  ]
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  const canSendMessage = !isLoading && inputValue.trim()

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSendMessage) {
      onSendMessage(inputValue.trim())
      setInputValue('')
    }
  }

  const handleSuggestionClick = (prompt: string) => {
    if (!isLoading) {
      onSendMessage(prompt)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Image
            className="outline outline-1 outline-neutral-200/20 rounded-lg"
            width={20}
            src={lrnaiIcon}
            alt="Magic Chat"
          />
          <span className="font-semibold text-sm text-white/70">{t('editor.blocks.magic_block_content.magic_chat')}</span>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
        {/* Show suggestions if no messages yet */}
        {messages.length === 0 && !isLoading && (
          <div className="space-y-4 pt-4">
            <p className="text-sm text-white/50 text-center">
              {t('editor.blocks.magic_block_content.describe_prompt')}
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
            className={cn(
              "flex",
              message.role === 'user' ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                message.role === 'user'
                  ? "bg-purple-600/80 text-white rounded-br-md"
                  : "bg-white/5 text-white/80 rounded-bl-md ring-1 ring-inset ring-white/10"
              )}
            >
              {message.role === 'user' ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-white/50 font-medium">{t('editor.blocks.magic_block_content.ai_generated')}</p>
                  <p className="text-white/60 text-xs">
                    {t('editor.blocks.magic_block_content.check_preview')}
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white/5 rounded-2xl rounded-bl-md px-4 py-3 ring-1 ring-inset ring-white/10">
              <div className="flex items-center gap-2">
                <CircleNotch weight="duotone" className="w-4 h-4 animate-spin text-purple-400" />
                <span className="text-sm text-white/50">{t('editor.blocks.magic_block_content.creating_magic')}</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-white/5 p-4">
        {styleReferenceActive && (
          <div className="mb-2 flex items-center gap-2 bg-purple-500/10 ring-1 ring-inset ring-purple-400/30 rounded-lg px-3 py-1.5">
            <Sparkle weight="duotone" className="w-3.5 h-3.5 text-purple-300" />
            <span className="text-xs text-purple-100 flex-1">
              {t('editor.blocks.magic_block_content.using_copied_style')}
            </span>
            <button
              type="button"
              onClick={onClearStyleReference}
              className="text-purple-200/70 hover:text-white p-0.5 rounded transition-colors"
              title={t('editor.blocks.magic_block_content.clear_style')}
            >
              <X weight="duotone" className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="relative">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              messages.length === 0
                ? t('editor.blocks.magic_block_content.placeholder_new')
                : t('editor.blocks.magic_block_content.placeholder_edit')
            }
            disabled={isLoading}
            rows={2}
            className={cn(
              "w-full resize-none rounded-lg ring-1 ring-inset ring-white/10 bg-gray-950/40 px-4 py-3 pr-12",
              "text-sm text-white placeholder:text-white/30",
              "focus:outline-none focus:ring-white/20",
              isLoading ? "opacity-30" : ""
            )}
          />
          <button
            type="submit"
            disabled={!canSendMessage}
            className={cn(
              "absolute right-3 bottom-3 p-2 rounded-lg transition-all delay-75 ease-linear",
              canSendMessage
                ? "bg-white/10 text-white/70 hover:text-white hover:bg-white/20 outline outline-1 outline-neutral-100/10 hover:outline-neutral-200/40"
                : "bg-white/5 text-white/30 cursor-not-allowed"
            )}
          >
            {isLoading ? (
              <CircleNotch weight="duotone" className="w-4 h-4 animate-spin" />
            ) : (
              <PaperPlaneTilt weight="duotone" className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

export default MagicBlockChat
