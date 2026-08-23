'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send } from 'lucide-react'
import * as Y from 'yjs'
import type { HocuspocusProvider } from '@hocuspocus/provider'

interface EphemeralChatProps {
  ydoc: Y.Doc | null
  provider: HocuspocusProvider | null
}

interface ChatMessage {
  text: string
  userId: string
  username: string
  color: string
  timestamp: number
}

interface EmojiReaction {
  id: string
  emoji: string
  username: string
  color: string
  timestamp: number
  xOffset: number
}

const PREVIEW_COUNT = 4
const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '👀']
const EMOJI_LIFETIME = 3500
const MESSAGE_LIFETIME = 3 * 60 * 1000 // 3 minutes
const CHAT_BUBBLE_LIFETIME = 4000 // 4 seconds on cursor

export default function EphemeralChat({ ydoc, provider }: EphemeralChatProps) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [reactions, setReactions] = useState<EmojiReaction[]>([])
  const [input, setInput] = useState('')
  const [isHovered, setIsHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Sync chat messages
  useEffect(() => {
    if (!ydoc) return
    const chatArray = ydoc.getArray<ChatMessage>('board-chat')
    const observer = () => setMessages(chatArray.toArray())
    chatArray.observe(observer)
    setMessages(chatArray.toArray())
    return () => chatArray.unobserve(observer)
  }, [ydoc])

  // Sync emoji reactions
  useEffect(() => {
    if (!ydoc) return
    const reactionsArray = ydoc.getArray<EmojiReaction>('board-reactions')
    const observer = () => setReactions(reactionsArray.toArray())
    reactionsArray.observe(observer)
    setReactions(reactionsArray.toArray())
    return () => reactionsArray.unobserve(observer)
  }, [ydoc])

  // Clean up expired reactions
  useEffect(() => {
    const timer = setInterval(() => {
      if (!ydoc) return
      const reactionsArray = ydoc.getArray<EmojiReaction>('board-reactions')
      const now = Date.now()
      for (let i = reactionsArray.length - 1; i >= 0; i--) {
        if (now - reactionsArray.get(i).timestamp > EMOJI_LIFETIME) {
          reactionsArray.delete(i, 1)
        }
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [ydoc])

  // Clean up messages older than 3 minutes
  useEffect(() => {
    const timer = setInterval(() => {
      if (!ydoc) return
      const chatArray = ydoc.getArray<ChatMessage>('board-chat')
      const now = Date.now()
      for (let i = chatArray.length - 1; i >= 0; i--) {
        if (now - chatArray.get(i).timestamp > MESSAGE_LIFETIME) {
          chatArray.delete(i, 1)
        }
      }
    }, 10000) // check every 10s
    return () => clearInterval(timer)
  }, [ydoc])

  // Force re-render periodically so expired messages disappear visually
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10000)
    return () => clearInterval(timer)
  }, [])

  // Auto-scroll to bottom when new messages arrive or when hovering
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isHovered])

  // Clear chat bubble from awareness after timeout
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sendMessage = () => {
    if (!input.trim() || !ydoc || !provider) return
    const chatArray = ydoc.getArray<ChatMessage>('board-chat')
    const awareness = provider.awareness
    const localState = awareness?.getLocalState()
    const text = input.trim()

    chatArray.push([{
      text,
      userId: String(awareness?.clientID || 0),
      username: localState?.user?.name || 'Anonymous',
      color: localState?.user?.color || '#958DF1',
      timestamp: Date.now(),
    }])

    // Show on cursor via awareness
    if (awareness) {
      awareness.setLocalStateField('chatBubble', { text, timestamp: Date.now() })
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
      bubbleTimerRef.current = setTimeout(() => {
        awareness.setLocalStateField('chatBubble', null)
      }, CHAT_BUBBLE_LIFETIME)
    }

    setInput('')
    inputRef.current?.focus()
  }

  const sendEmoji = useCallback((emoji: string) => {
    if (!ydoc || !provider) return
    const reactionsArray = ydoc.getArray<EmojiReaction>('board-reactions')
    const awareness = provider.awareness
    const localState = awareness?.getLocalState()
    reactionsArray.push([{
      id: `${Date.now()}-${awareness?.clientID || 0}-${Math.random().toString(36).slice(2, 6)}`,
      emoji,
      username: localState?.user?.name || 'Anonymous',
      color: localState?.user?.color || '#958DF1',
      timestamp: Date.now(),
      xOffset: 10 + Math.random() * 50,
    }])
  }, [ydoc, provider])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Filter to only show recent messages (< 3 min)
  const now = Date.now()
  const recentMessages = messages.filter((m) => now - m.timestamp < MESSAGE_LIFETIME)
  const previewMessages = recentMessages.slice(-PREVIEW_COUNT)

  const frostedStyle = {
    background: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  }

  return (
    <>
      {/* CSS keyframes for emoji float-up */}
      <style jsx>{`
        @keyframes emoji-float {
          0% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
          70% {
            transform: translateY(-120px) scale(1.1);
            opacity: 1;
          }
          100% {
            transform: translateY(-180px) scale(0.8);
            opacity: 0;
          }
        }
      `}</style>

      {/* Floating emoji bursts — positioned absolutely relative to the board */}
      <div className="fixed bottom-36 end-5 z-30 pointer-events-none" style={{ width: 280, height: 250 }}>
        {reactions.map((r) => (
          <div
            key={r.id}
            className="absolute bottom-0 flex flex-col items-center gap-1"
            style={{
              right: `${r.xOffset}%`,
              animation: `emoji-float ${EMOJI_LIFETIME}ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards`,
            }}
          >
            <span className="text-4xl" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}>
              {r.emoji}
            </span>
            <span
              className="text-[9px] font-bold px-2 py-0.5 rounded-full text-white whitespace-nowrap"
              style={{ backgroundColor: r.color }}
            >
              {r.username}
            </span>
          </div>
        ))}
      </div>

      {/* Chat area */}
      <div
        className="flex flex-col items-end gap-1.5"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Messages area — preview when idle, full list on hover */}
        {recentMessages.length > 0 && (
          <div
            ref={scrollRef}
            className="flex flex-col items-end gap-1.5 pointer-events-auto"
            style={{
              maxHeight: isHovered ? 300 : undefined,
              overflowY: isHovered ? 'auto' : 'hidden',
              scrollbarWidth: 'thin',
              scrollbarColor: '#d1d5db transparent',
            }}
          >
            {(isHovered ? recentMessages : previewMessages).map((msg, i, arr) => {
              const age = arr.length - i
              const opacity = isHovered ? 1 : age <= 1 ? 1 : age <= 2 ? 0.85 : age <= 3 ? 0.6 : 0.4

              return (
                <div
                  key={msg.timestamp + msg.userId}
                  className="flex items-center gap-[7px] rounded-[15px] px-3 py-2.5 nice-shadow shrink-0"
                  style={{ ...frostedStyle, opacity, transition: 'opacity 0.4s ease' }}
                >
                  <div
                    className="h-[25px] w-[25px] rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ backgroundColor: msg.color }}
                  >
                    {msg.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs font-bold text-gray-800 shrink-0">{msg.username}</span>
                  <span className="text-xs text-gray-600 max-w-[220px] break-words">{msg.text}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Emoji quick-send bar */}
        <div
          className="flex items-center gap-[7px] rounded-[15px] px-3 py-2.5 nice-shadow pointer-events-auto"
          style={frostedStyle}
        >
          {QUICK_EMOJIS.map((emoji) => (
            <div
              key={emoji}
              onClick={() => sendEmoji(emoji)}
              className="editor-tool-btn cursor-pointer hover:scale-110 transition-transform"
              style={{ fontSize: 14 }}
            >
              {emoji}
            </div>
          ))}
        </div>

        {/* Text input bar */}
        <div
          className="flex items-center gap-[7px] rounded-[15px] px-3 py-2.5 nice-shadow pointer-events-auto"
          style={frostedStyle}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('boards.chat.placeholder')}
            className="w-44 px-1 py-0.5 text-xs bg-transparent border-none focus:outline-none text-gray-800 placeholder-gray-400"
          />
          <div
            onClick={input.trim() ? sendMessage : undefined}
            className={`editor-tool-btn editor-tool-btn-info ${!input.trim() ? 'opacity-30 pointer-events-none' : ''}`}
          >
            <Send size={12} />
          </div>
        </div>
      </div>
    </>
  )
}
