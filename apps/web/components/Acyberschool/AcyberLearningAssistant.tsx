'use client'

import React, { useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, Bot, Sparkles, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useActivity } from '@/hooks/queries/useActivity'
import { getMyAppliedLearning } from '@services/applied-learning/appliedLearning'
import {
  sendActivityAIChatMessageStream,
  startActivityAIChatSessionStream,
  type StreamCallbacks,
} from '@services/ai/ai'

const RED = '#C51635'
const NAVY = '#0B263D'

type Message = { id: string; role: 'user' | 'assistant'; content: string }

function clean(value?: string) {
  return (value || '').replace('activity_', '').replace('course_', '')
}

function parsePath(pathname: string | null) {
  if (!pathname) return null
  const match = pathname.match(/\/course\/([^/]+)\/activity\/([^/?#]+)/)
  if (!match || match[2] === 'end') return null
  return { courseUuid: clean(match[1]), activityUuid: clean(match[2]) }
}

export default function AcyberLearningAssistant() {
  const pathname = usePathname()
  const route = useMemo(() => parsePath(pathname), [pathname])
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token as string | undefined
  const { data: activity } = useActivity(route?.activityUuid || '')
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [sessionUuid, setSessionUuid] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: portfolio = [] } = useQuery({
    queryKey: ['applied-learning', 'assistant-context', org?.id],
    queryFn: () => getMyAppliedLearning(org?.id, token),
    enabled: !!route && !!org?.id && !!token,
    staleTime: 60_000,
  })

  if (!route || session?.status !== 'authenticated') return null

  const latestApplication = portfolio?.[0]

  const contextualize = (question: string) => {
    const pieces = [
      `You are helping a learner apply the current lesson in real work.`,
      org?.name ? `Learning organisation: ${org.name}.` : '',
      activity?.name ? `Current lesson: ${activity.name}.` : '',
      latestApplication?.planned_application
        ? `The learner's most recent application intention is: ${latestApplication.planned_application}`
        : '',
      latestApplication?.measurable_change
        ? `The learner has recorded this measurable change from prior application: ${latestApplication.measurable_change}`
        : '',
      `Answer the learner's question directly. Use plain language. When useful, connect the answer to a practical workplace action and a measurable outcome. Do not assume the course is about AI; follow the subject matter of the current lesson. Separate what is known from what is a suggestion or hypothesis.`,
      `Learner question: ${question}`,
    ]
    return pieces.filter(Boolean).join('\n\n')
  }

  const send = async (value?: string) => {
    const question = (value ?? input).trim()
    if (!question || streaming || !token || !activity?.activity_uuid) return

    const userMessage: Message = { id: `u-${Date.now()}`, role: 'user', content: question }
    setMessages((old) => [...old, userMessage])
    setInput('')
    setStreaming(true)
    setStreamText('')
    setError(null)
    let accumulated = ''

    const callbacks: StreamCallbacks = {
      onStart: (data) => {
        if (data.aichat_uuid) setSessionUuid(data.aichat_uuid)
      },
      onChunk: (chunk) => {
        accumulated += chunk
        setStreamText(accumulated)
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }))
      },
      onComplete: (data) => {
        if (data.aichat_uuid) setSessionUuid(data.aichat_uuid)
        if (accumulated.trim()) {
          setMessages((old) => [...old, { id: `a-${Date.now()}`, role: 'assistant', content: accumulated }])
        }
        setStreamText('')
        setStreaming(false)
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }))
      },
      onError: (message) => {
        setError(message || 'The learning assistant is unavailable right now.')
        setStreamText('')
        setStreaming(false)
      },
    }

    const prompt = contextualize(question)
    if (sessionUuid) {
      await sendActivityAIChatMessageStream(prompt, sessionUuid, activity.activity_uuid, token, callbacks)
    } else {
      await startActivityAIChatSessionStream(prompt, activity.activity_uuid, token, callbacks)
    }
  }

  const suggestions = [
    'Explain this simply',
    'How can I apply this at work?',
    'Give me a practical example',
    'What should I measure?',
  ]

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 left-4 z-[70] flex min-h-12 items-center gap-2 rounded-full px-4 py-3 text-sm font-extrabold text-white shadow-[0_12px_35px_rgba(11,38,61,0.24)] md:bottom-7 md:left-7"
        style={{ backgroundColor: NAVY }}
      >
        <Sparkles className="h-4 w-4 text-[#FF6E87]" />
        Ask AI
      </button>

      {open && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/45 sm:items-center sm:p-5">
          <section className="flex h-[88vh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:h-[720px] sm:max-h-[88vh] sm:max-w-2xl sm:rounded-[28px]">
            <header className="flex items-start justify-between border-b border-black/[0.07] px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ backgroundColor: NAVY }}><Bot className="h-5 w-5" /></span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: RED }}>Learning assistant</p>
                  <h2 className="text-lg font-black">Ask about this lesson</h2>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-full p-2 text-black/40 hover:bg-black/[0.04]" aria-label="Close AI assistant"><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              {messages.length === 0 && !streaming && (
                <div className="rounded-[22px] p-5 text-white" style={{ backgroundColor: NAVY }}>
                  <p className="text-sm font-extrabold">Use AI to understand more, then bring it back to your work.</p>
                  <p className="mt-2 text-sm leading-6 text-white/65">I can explain the lesson, give examples, challenge your thinking and help you turn the concept into a practical action.</p>
                  <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {suggestions.map((suggestion) => (
                      <button key={suggestion} onClick={() => send(suggestion)} className="rounded-xl border border-white/15 bg-white/[0.06] px-3 py-3 text-left text-xs font-bold text-white hover:bg-white/[0.1]">{suggestion}</button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'text-white' : 'border border-black/[0.07] bg-[#F7F8FA] text-[#101418]'}`} style={message.role === 'user' ? { backgroundColor: RED } : undefined}>
                      {message.role === 'assistant' ? <ReactMarkdown>{message.content}</ReactMarkdown> : message.content}
                    </div>
                  </div>
                ))}
                {streaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[88%] rounded-2xl border border-black/[0.07] bg-[#F7F8FA] px-4 py-3 text-sm leading-6 text-[#101418]">
                      {streamText ? <ReactMarkdown>{streamText}</ReactMarkdown> : <span className="text-black/40">Thinking...</span>}
                    </div>
                  </div>
                )}
                {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
                <div ref={bottomRef} />
              </div>
            </div>

            <footer className="border-t border-black/[0.07] bg-white p-4 sm:px-6">
              <div className="flex items-end gap-2 rounded-2xl border border-black/10 bg-[#FAFAFA] p-2 focus-within:border-[#C51635]/40">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  rows={2}
                  placeholder="Ask for an explanation, example or help applying this..."
                  className="max-h-32 min-h-[46px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 outline-none"
                />
                <button disabled={!input.trim() || streaming} onClick={() => send()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white disabled:opacity-30" style={{ backgroundColor: RED }} aria-label="Send"><ArrowUp className="h-4 w-4" /></button>
              </div>
              <p className="mt-2 text-center text-[10px] text-black/35">Use AI to support your thinking. Your judgement and application remain yours.</p>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}