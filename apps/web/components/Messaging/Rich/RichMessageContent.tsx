'use client'

/**
 * Renders one message body: markdown (GFM, math, highlighted code), citations
 * with hover previews, callouts, the interactive blocks agents can write
 * (quiz, flashcards, steps, course cards), and an agent reply's live progress,
 * sources and follow-up suggestions.
 */

import React, { useMemo } from 'react'
import { ArrowBendDownRight, CheckCircle, CircleNotch, MagnifyingGlass, PencilSimpleLine, WarningCircle } from '@phosphor-icons/react'
import type { AgentSource, ChatMessage } from '@services/messaging/messaging'
import type { AgentProgress } from '@components/Messaging/MessagingProvider'
import MessageMarkdown from './MessageMarkdown'
import { CourseBlock, FlashcardsBlock, PendingBlock, QuizBlock, StepsBlock } from './Blocks'
import { SourcesStrip } from './Sources'
import { ChartBlock, ExerciseBlock, MindmapBlock, ReminderBlock, TimelineBlock } from './MoreBlocks'
import { isEmojiOnly, parseSegments } from './parse'

export type RichMessageContentProps = {
  message: ChatMessage
  /** Live progress while an agent reply streams (from useMessaging().agentProgress). */
  progress?: AgentProgress
  orgslug: string
  /** Called when the reader clicks a follow-up suggestion or "ask about this". */
  onFollowUp?: (_text: string) => void
  /** True for the viewer's own bubble (dark background). */
  inverted?: boolean
}

const EMPTY_SOURCES: AgentSource[] = []

function Caret() {
  return <span className="inline-block w-[3px] h-4 ms-0.5 -mb-0.5 rounded-full bg-current opacity-70 animate-pulse align-baseline" />
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      {[0, 150, 300].map((d) => (
        <span key={d} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  )
}

function PhaseRow({ state, icon, label }: { state: 'active' | 'done'; icon: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-2 text-xs transition-colors ${state === 'active' ? 'text-gray-800' : 'text-gray-400'}`}>
      <span className="inline-flex items-center justify-center w-4 h-4">
        {state === 'done' ? <CheckCircle size={15} weight="fill" className="text-green-500" /> : icon}
      </span>
      <span className="font-medium">{label}</span>
    </div>
  )
}

/** What an agent is doing before its first words arrive. */
function AgentProgressView({ progress, orgslug }: { progress?: AgentProgress; orgslug: string }) {
  const phase = progress?.phase
  if (!phase) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Dots />
      </div>
    )
  }
  const searched = phase !== 'searching'
  const sources = progress?.sources || []
  return (
    <div className="space-y-1.5 py-0.5">
      {progress?.courses !== undefined && (
        <PhaseRow
          state={searched ? 'done' : 'active'}
          icon={<MagnifyingGlass size={13} weight="bold" className="animate-pulse" />}
          label={`Searching ${progress.courses} course${progress.courses === 1 ? '' : 's'}…`}
        />
      )}
      {searched && progress?.courses !== undefined && (
        <PhaseRow
          state="done"
          icon={null}
          label={sources.length ? `Found ${sources.length} source${sources.length === 1 ? '' : 's'}` : 'No matching course content'}
        />
      )}
      {searched && sources.length > 0 && (
        <div className="ps-6">
          <SourcesStrip sources={sources} orgslug={orgslug} compact />
        </div>
      )}
      {(phase === 'writing' || progress?.courses === undefined) && (
        <PhaseRow
          state="active"
          icon={<CircleNotch size={13} weight="bold" className="animate-spin" />}
          label={
            <span className="inline-flex items-center gap-1.5">
              <PencilSimpleLine size={12} weight="bold" />
              Writing
            </span>
          }
        />
      )}
    </div>
  )
}

function RichMessageContent({ message, progress, orgslug, onFollowUp, inverted = false }: RichMessageContentProps) {
  const streaming = message.status === 'streaming'
  const isAgent = message.sender?.type === 'agent'
  const content = message.content || ''
  const sources = message.attachment?.sources ?? progress?.sources ?? EMPTY_SOURCES
  const segments = useMemo(() => parseSegments(content, streaming), [content, streaming])
  const emojiOnly = useMemo(() => !isAgent && isEmojiOnly(content), [isAgent, content])

  if (message.deleted) {
    return <span className={`italic text-sm ${inverted ? 'text-white/60' : 'text-gray-400'}`}>Message deleted</span>
  }

  if (message.kind === 'system') {
    return <span className="text-xs text-gray-500">{content}</span>
  }

  if (emojiOnly) {
    return <div className="text-[40px] leading-[1.15] tracking-wide select-text">{content.trim()}</div>
  }

  if (isAgent && streaming && !content) {
    return <AgentProgressView progress={progress} orgslug={orgslug} />
  }

  const followUps = !streaming && message.status === 'complete' ? message.attachment?.follow_ups || [] : []

  return (
    <div className="min-w-0 space-y-2">
      {isAgent && streaming && sources.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
          <CheckCircle size={12} weight="fill" className="text-green-500" />
          From {sources.length} source{sources.length === 1 ? '' : 's'}
        </div>
      )}

      <div>
        {segments.map((seg, i) => {
          const last = i === segments.length - 1
          switch (seg.type) {
            case 'markdown':
              return (
                <MessageMarkdown
                  key={i}
                  content={seg.text}
                  sources={sources}
                  orgslug={orgslug}
                  streaming={streaming && last}
                  inverted={inverted}
                  agent={isAgent}
                />
              )
            case 'quiz':
              return <QuizBlock key={i} data={seg.data} />
            case 'flashcards':
              return <FlashcardsBlock key={i} data={seg.data} />
            case 'steps':
              return <StepsBlock key={i} data={seg.data} />
            case 'course':
              return <CourseBlock key={i} data={seg.data} courses={message.attachment?.courses} orgslug={orgslug} />
            case 'chart':
              return <ChartBlock key={i} data={seg.data} />
            case 'mindmap':
              return <MindmapBlock key={i} data={seg.data} />
            case 'timeline':
              return <TimelineBlock key={i} data={seg.data} />
            case 'exercise':
              return <ExerciseBlock key={i} data={seg.data} />
            case 'reminder':
              return <ReminderBlock key={i} data={seg.data} reminder={message.attachment?.reminders?.[seg.index]} />
            case 'pending':
              return <PendingBlock key={i} kind={seg.kind} />
          }
        })}
        {streaming && segments[segments.length - 1]?.type !== 'pending' && <Caret />}
      </div>

      {message.status === 'error' && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <WarningCircle size={14} weight="fill" />
          This reply didn&apos;t finish. Try asking again.
        </div>
      )}

      {isAgent && !streaming && sources.length > 0 && <SourcesStrip sources={sources} orgslug={orgslug} />}

      {followUps.length > 0 && onFollowUp && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {followUps.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onFollowUp(q)}
              className="group inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors text-start"
            >
              <ArrowBendDownRight size={12} weight="bold" className="text-gray-400 group-hover:text-gray-900 shrink-0" />
              <span className="line-clamp-1">{q}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default React.memo(RichMessageContent)
